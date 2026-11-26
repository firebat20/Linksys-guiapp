package main

import (
	"bytes"
	"fmt"
	"net"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/reujab/linksys"
)

const (
	jnapGetLANSettings = "router/GetLANSettings"
	jnapSetLANSettings = "router/SetLANSettings"

	defaultMaxReservationDescriptionLength = 63
)

// DHCPReservationData represents a single static DHCP lease on the router.
type DHCPReservationData struct {
	MACAddress  string `json:"macAddress"`
	IPAddress   string `json:"ipAddress"`
	Description string `json:"description"`
}

// LANSettingsData contains the local network information needed to manage
// DHCP reservations safely.
type LANSettingsData struct {
	IPAddress                       string                `json:"ipAddress"`
	NetworkPrefixLength             int                   `json:"networkPrefixLength"`
	HostName                        string                `json:"hostName"`
	IsDHCPEnabled                   bool                  `json:"isDHCPEnabled"`
	DHCPFirstIPAddress              string                `json:"dhcpFirstIPAddress"`
	DHCPLastIPAddress               string                `json:"dhcpLastIPAddress"`
	LeaseMinutes                    int                   `json:"leaseMinutes"`
	MaxReservationDescriptionLength int                   `json:"maxReservationDescriptionLength"`
	Reservations                    []DHCPReservationData `json:"reservations"`
}

// readOnlyLANFields are capability fields returned by GetLANSettings that the
// router's web UI removes before calling SetLANSettings.
var readOnlyLANFields = []string{
	"minNetworkPrefixLength",
	"maxNetworkPrefixLength",
	"maxDHCPReservationDescriptionLength",
	"minAllowedDHCPLeaseMinutes",
	"maxAllowedDHCPLeaseMinutes",
}

func (s *LinksysService) requireClient() (*linksys.Client, error) {
	s.mu.Lock()
	client := s.client
	authDone := s.authDone
	s.mu.Unlock()

	if !authDone || client == nil {
		return nil, fmt.Errorf("not connected to router")
	}
	return client, nil
}

// fetchLANSettings returns the LAN settings object and the key it was wrapped
// in, if the firmware uses an envelope such as {"lanSettings": {...}}.
func fetchLANSettings(client *linksys.Client) (map[string]interface{}, string, error) {
	var output map[string]interface{}
	if err := client.MakeRequest(jnapGetLANSettings, nil, &output); err != nil {
		return nil, "", fmt.Errorf("failed to read LAN settings: %w", err)
	}
	if output == nil {
		return nil, "", fmt.Errorf("router returned empty LAN settings")
	}

	if wrapped, ok := output["lanSettings"].(map[string]interface{}); ok {
		return wrapped, "lanSettings", nil
	}
	return output, "", nil
}

func stringValue(value interface{}) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

func intValue(value interface{}) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case float32:
		return int(number)
	case int:
		return number
	case int64:
		return int(number)
	default:
		return 0
	}
}

func boolValue(value interface{}) bool {
	enabled, _ := value.(bool)
	return enabled
}

func normalizeMAC(raw string) string {
	raw = strings.TrimSpace(raw)
	if hardwareAddr, err := net.ParseMAC(raw); err == nil {
		return strings.ToUpper(hardwareAddr.String())
	}
	return strings.ToUpper(raw)
}

func parseReservations(raw interface{}) ([]DHCPReservationData, error) {
	reservations := make([]DHCPReservationData, 0)
	if raw == nil {
		return reservations, nil
	}

	items, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("router returned an unexpected DHCP reservation format")
	}

	for _, item := range items {
		entry, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		reservations = append(reservations, DHCPReservationData{
			MACAddress:  normalizeMAC(stringValue(entry["macAddress"])),
			IPAddress:   stringValue(entry["ipAddress"]),
			Description: stringValue(entry["description"]),
		})
	}
	return reservations, nil
}

func lanSettingsData(lan map[string]interface{}) (*LANSettingsData, error) {
	dhcpSettings, ok := lan["dhcpSettings"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("router did not return DHCP settings")
	}

	reservations, err := parseReservations(dhcpSettings["reservations"])
	if err != nil {
		return nil, err
	}

	maxDescriptionLength := intValue(lan["maxDHCPReservationDescriptionLength"])
	if maxDescriptionLength <= 0 {
		maxDescriptionLength = defaultMaxReservationDescriptionLength
	}

	return &LANSettingsData{
		IPAddress:                       stringValue(lan["ipAddress"]),
		NetworkPrefixLength:             intValue(lan["networkPrefixLength"]),
		HostName:                        stringValue(lan["hostName"]),
		IsDHCPEnabled:                   boolValue(lan["isDHCPEnabled"]),
		DHCPFirstIPAddress:              stringValue(dhcpSettings["firstClientIPAddress"]),
		DHCPLastIPAddress:               stringValue(dhcpSettings["lastClientIPAddress"]),
		LeaseMinutes:                    intValue(dhcpSettings["leaseMinutes"]),
		MaxReservationDescriptionLength: maxDescriptionLength,
		Reservations:                    reservations,
	}, nil
}

func setReservations(lan map[string]interface{}, reservations []DHCPReservationData) error {
	dhcpSettings, ok := lan["dhcpSettings"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("router did not return DHCP settings")
	}

	items := make([]interface{}, 0, len(reservations))
	for _, reservation := range reservations {
		items = append(items, map[string]interface{}{
			"macAddress":  reservation.MACAddress,
			"ipAddress":   reservation.IPAddress,
			"description": reservation.Description,
		})
	}
	dhcpSettings["reservations"] = items
	return nil
}

func stripReadOnlyLANFields(lan map[string]interface{}) {
	for _, field := range readOnlyLANFields {
		delete(lan, field)
	}
}

func validateReservationInput(macAddress, ipAddress, description string, data *LANSettingsData) (string, string, string, error) {
	macAddress = strings.TrimSpace(macAddress)
	ipAddress = strings.TrimSpace(ipAddress)
	description = strings.TrimSpace(description)

	hardwareAddr, err := net.ParseMAC(macAddress)
	if err != nil {
		return "", "", "", fmt.Errorf("invalid MAC address %q: %w", macAddress, err)
	}
	if len(hardwareAddr) != 6 {
		return "", "", "", fmt.Errorf("invalid MAC address %q: expected 48-bit Ethernet MAC", macAddress)
	}
	normalizedMAC := strings.ToUpper(hardwareAddr.String())
	if normalizedMAC == "00:00:00:00:00:00" || normalizedMAC == "FF:FF:FF:FF:FF:FF" {
		return "", "", "", fmt.Errorf("cannot reserve special MAC address %s", normalizedMAC)
	}

	parsedIP := net.ParseIP(ipAddress)
	if parsedIP == nil || parsedIP.To4() == nil {
		return "", "", "", fmt.Errorf("invalid IPv4 address %q", ipAddress)
	}
	normalizedIP := parsedIP.To4().String()

	if data != nil && normalizedIP == data.IPAddress {
		return "", "", "", fmt.Errorf("cannot reserve the router's own IP address (%s)", data.IPAddress)
	}

	maxDescriptionLength := defaultMaxReservationDescriptionLength
	if data != nil && data.MaxReservationDescriptionLength > 0 {
		maxDescriptionLength = data.MaxReservationDescriptionLength
	}
	if utf8.RuneCountInString(description) > maxDescriptionLength {
		return "", "", "", fmt.Errorf("description must be %d characters or fewer", maxDescriptionLength)
	}

	if data != nil && data.NetworkPrefixLength > 0 && data.NetworkPrefixLength <= 32 {
		routerIP := net.ParseIP(data.IPAddress)
		if routerIP != nil && routerIP.To4() != nil {
			mask := net.CIDRMask(data.NetworkPrefixLength, 32)
			lanNet := &net.IPNet{
				IP:   routerIP.To4().Mask(mask),
				Mask: mask,
			}

			if !lanNet.Contains(parsedIP.To4()) {
				return "", "", "", fmt.Errorf(
					"IP address %s is outside the router's subnet (%s/%d)",
					normalizedIP,
					lanNet.IP.String(),
					data.NetworkPrefixLength,
				)
			}

			if data.NetworkPrefixLength <= 30 {
				ip4 := parsedIP.To4()
				net4 := lanNet.IP.To4()
				bcast4 := make(net.IP, 4)
				for i := 0; i < 4; i++ {
					bcast4[i] = net4[i] | ^mask[i]
				}

				if bytes.Equal(ip4, net4) {
					return "", "", "", fmt.Errorf("cannot reserve the subnet network address (%s)", normalizedIP)
				}
				if bytes.Equal(ip4, bcast4) {
					return "", "", "", fmt.Errorf("cannot reserve the subnet broadcast address (%s)", normalizedIP)
				}
			}
		}
	}

	if data != nil && data.IsDHCPEnabled {
		firstIP := net.ParseIP(data.DHCPFirstIPAddress)
		lastIP := net.ParseIP(data.DHCPLastIPAddress)
		if firstIP != nil && firstIP.To4() != nil && lastIP != nil && lastIP.To4() != nil {
			if bytes.Compare(parsedIP.To4(), firstIP.To4()) < 0 || bytes.Compare(parsedIP.To4(), lastIP.To4()) > 0 {
				return "", "", "", fmt.Errorf(
					"IP address must be inside the DHCP pool (%s – %s)",
					data.DHCPFirstIPAddress,
					data.DHCPLastIPAddress,
				)
			}
		}
	}

	return normalizedMAC, normalizedIP, description, nil
}

func reservationConflict(reservations []DHCPReservationData, macAddress, ipAddress string, skipIndex int) error {
	for index, reservation := range reservations {
		if index == skipIndex {
			continue
		}
		if strings.EqualFold(reservation.MACAddress, macAddress) {
			return fmt.Errorf("a reservation for MAC address %s already exists", macAddress)
		}
		if reservation.IPAddress == ipAddress {
			return fmt.Errorf("IP address %s is already reserved", ipAddress)
		}
	}
	return nil
}

// updateReservations performs a read-modify-write of the full LAN settings
// object. This is required because SetLANSettings replaces the entire object.
func (s *LinksysService) updateReservations(mutate func(*LANSettingsData) ([]DHCPReservationData, error)) (*LANSettingsData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	s.dhcpMu.Lock()
	defer s.dhcpMu.Unlock()

	lan, wrapKey, err := fetchLANSettings(client)
	if err != nil {
		return nil, err
	}

	current, err := lanSettingsData(lan)
	if err != nil {
		return nil, err
	}

	updated, err := mutate(current)
	if err != nil {
		return nil, err
	}

	stripReadOnlyLANFields(lan)
	if err := setReservations(lan, updated); err != nil {
		return nil, err
	}

	var payload interface{} = lan
	if wrapKey != "" {
		payload = map[string]interface{}{wrapKey: lan}
	}

	if err := client.MakeRequest(jnapSetLANSettings, payload, nil); err != nil {
		return nil, fmt.Errorf("failed to save DHCP reservations: %w", err)
	}

	// Re-read so the UI always reflects the router's authoritative state.
	// Applying LAN settings restarts DHCP/dnsmasq services on the router, which
	// may cause brief transient connection drops for 1-2 seconds.
	var lastFetchErr error
	for attempt := 0; attempt < 3; attempt++ {
		time.Sleep(time.Duration(300*(attempt+1)) * time.Millisecond)
		lan, _, lastFetchErr = fetchLANSettings(client)
		if lastFetchErr == nil {
			return lanSettingsData(lan)
		}
	}

	// If refreshing still fails due to router service restart, return the mutated state
	// directly instead of failing with an error, because the reservations were successfully applied.
	// We clone from 'current' to preserve capability metadata (such as max description length).
	if current != nil {
		fallbackData := *current
		fallbackData.Reservations = updated
		return &fallbackData, nil
	}

	return nil, fmt.Errorf("reservations were saved, but refreshing LAN settings failed: %w", lastFetchErr)
}

func findReservationIndex(reservations []DHCPReservationData, macAddress string) int {
	for index, reservation := range reservations {
		if strings.EqualFold(reservation.MACAddress, macAddress) {
			return index
		}
	}
	return -1
}

// GetDHCPReservations returns the current DHCP reservations and LAN settings.
func (s *LinksysService) GetDHCPReservations() (*LANSettingsData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	s.dhcpMu.Lock()
	defer s.dhcpMu.Unlock()

	lan, _, err := fetchLANSettings(client)
	if err != nil {
		return nil, err
	}
	return lanSettingsData(lan)
}

// AddDHCPReservation reserves an IP address for a MAC address.
func (s *LinksysService) AddDHCPReservation(macAddress, ipAddress, description string) (*LANSettingsData, error) {
	return s.updateReservations(func(data *LANSettingsData) ([]DHCPReservationData, error) {
		normalizedMAC, normalizedIP, normalizedDescription, err := validateReservationInput(macAddress, ipAddress, description, data)
		if err != nil {
			return nil, err
		}
		if err := reservationConflict(data.Reservations, normalizedMAC, normalizedIP, -1); err != nil {
			return nil, err
		}

		updated := make([]DHCPReservationData, 0, len(data.Reservations)+1)
		updated = append(updated, data.Reservations...)
		updated = append(updated, DHCPReservationData{
			MACAddress:  normalizedMAC,
			IPAddress:   normalizedIP,
			Description: normalizedDescription,
		})
		return updated, nil
	})
}

// UpdateDHCPReservation changes an existing reservation identified by its
// original MAC address.
func (s *LinksysService) UpdateDHCPReservation(originalMACAddress, macAddress, ipAddress, description string) (*LANSettingsData, error) {
	originalMAC := normalizeMAC(originalMACAddress)
	if originalMAC == "" {
		return nil, fmt.Errorf("original MAC address is required")
	}

	return s.updateReservations(func(data *LANSettingsData) ([]DHCPReservationData, error) {
		targetIndex := findReservationIndex(data.Reservations, originalMAC)
		if targetIndex < 0 {
			return nil, fmt.Errorf("reservation for MAC address %s was not found", originalMAC)
		}

		normalizedMAC, normalizedIP, normalizedDescription, err := validateReservationInput(macAddress, ipAddress, description, data)
		if err != nil {
			return nil, err
		}
		if err := reservationConflict(data.Reservations, normalizedMAC, normalizedIP, targetIndex); err != nil {
			return nil, err
		}

		updated := make([]DHCPReservationData, len(data.Reservations))
		copy(updated, data.Reservations)
		updated[targetIndex] = DHCPReservationData{
			MACAddress:  normalizedMAC,
			IPAddress:   normalizedIP,
			Description: normalizedDescription,
		}
		return updated, nil
	})
}

// DeleteDHCPReservation removes the reservation for a MAC address.
func (s *LinksysService) DeleteDHCPReservation(macAddress string) (*LANSettingsData, error) {
	targetMAC := normalizeMAC(macAddress)
	if targetMAC == "" {
		return nil, fmt.Errorf("MAC address is required")
	}

	return s.updateReservations(func(data *LANSettingsData) ([]DHCPReservationData, error) {
		targetIndex := findReservationIndex(data.Reservations, targetMAC)
		if targetIndex < 0 {
			return nil, fmt.Errorf("reservation for MAC address %s was not found", targetMAC)
		}

		updated := make([]DHCPReservationData, 0, len(data.Reservations)-1)
		updated = append(updated, data.Reservations[:targetIndex]...)
		updated = append(updated, data.Reservations[targetIndex+1:]...)
		return updated, nil
	})
}
