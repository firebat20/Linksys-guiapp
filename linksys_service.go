package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/reujab/linksys"
)

type ConnectionResult struct {
	Success bool   `json:"success"`
	Host    string `json:"host"`
	Message string `json:"message"`
}

type RouterInfoData struct {
	ModelNumber     string `json:"modelNumber"`
	SerialNumber    string `json:"serialNumber"`
	HardwareVersion string `json:"hardwareVersion"`
	FirmwareVersion string `json:"firmwareVersion"`
	FirmwareDate    string `json:"firmwareDate"`
	Manufacturer    string `json:"manufacturer"`
	MACAddress      string `json:"macAddress"`
}

type FirmwareUpdateData struct {
	LastCheck        string `json:"lastCheck"`
	UpdateAvailable  bool   `json:"updateAvailable"`
	NewVersion       string `json:"newVersion"`
	NewDate          string `json:"newDate"`
	Description      string `json:"description"`
	PendingOperation string `json:"pendingOperation"`
	ProgressPercent  int    `json:"progressPercent"`
}

type DeviceData struct {
	ID             string `json:"id"`
	FriendlyName   string `json:"friendlyName"`
	DeviceType     string `json:"deviceType"`
	IPAddress      string `json:"ipAddress"`
	MACAddress     string `json:"macAddress"`
	IsConnected    bool   `json:"isConnected"`
	ConnectionType string `json:"connectionType"`
	Model          string `json:"model"`
	Manufacturer   string `json:"manufacturer"`
	OS             string `json:"os"`
}

type LinksysService struct {
	ctx        context.Context
	mu         sync.Mutex
	dhcpMu     sync.Mutex
	client     *linksys.Client
	fastClient *http.Client
	host       string
	authDone   bool
	connSeq    uint64
}

func newRouterTransport() *http.Transport {
	return &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
}

func NewLinksysService() *LinksysService {
	// Configure HTTP client with a 10s timeout to prevent hanging on unreachable IPs,
	// and allow local router HTTPS certificates (which are almost universally self-signed).
	transport := newRouterTransport()
	linksys.HTTPClient = &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
	}
	return &LinksysService{
		fastClient: &http.Client{
			Timeout:   2 * time.Second,
			Transport: transport,
		},
	}
}

func (s *LinksysService) Startup(ctx context.Context) {
	s.ctx = ctx
}

func parseRouterEndpoint(rawHost string) (scheme string, hostPort string, hasExplicitScheme bool, err error) {
	trimmed := strings.TrimSpace(rawHost)
	if trimmed == "" {
		return "", "", false, fmt.Errorf("Host/IP address is required")
	}

	lower := strings.ToLower(trimmed)
	hasExplicitScheme = strings.Contains(trimmed, "://")
	formatted := trimmed
	if !hasExplicitScheme {
		// Wrap bare IPv6 addresses (e.g. "fd00::1") so url.Parse treats them as hosts.
		if strings.Count(trimmed, ":") >= 2 && !strings.HasPrefix(trimmed, "[") {
			formatted = "[" + trimmed + "]"
		}
		formatted = "http://" + formatted
	} else if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return "", "", true, fmt.Errorf("Invalid host scheme: only HTTP and HTTPS are supported")
	}

	u, parseErr := url.Parse(formatted)
	if parseErr != nil || u.Host == "" {
		if parseErr != nil {
			return "", "", hasExplicitScheme, fmt.Errorf("Invalid host format: %v", parseErr)
		}
		return "", "", hasExplicitScheme, fmt.Errorf("Invalid host format: missing host or IP address")
	}

	return strings.ToLower(u.Scheme), u.Host, hasExplicitScheme, nil
}

func (s *LinksysService) Connect(host string, password string) (*ConnectionResult, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return &ConnectionResult{Success: false, Message: "Host/IP address is required"}, nil
	}

	if password == "" {
		return &ConnectionResult{Success: false, Message: "Password is required"}, nil
	}

	scheme, hostPort, hasExplicitScheme, err := parseRouterEndpoint(host)
	if err != nil {
		return &ConnectionResult{Success: false, Message: err.Error()}, nil
	}

	s.mu.Lock()
	s.connSeq++
	seq := s.connSeq
	s.mu.Unlock()

	endpoint := fmt.Sprintf("%s://%s/JNAP/", scheme, hostPort)
	client := linksys.NewClient()
	client.Endpoint = endpoint

	err = client.Authorize(password)
	// If the user did not specify a scheme and HTTP authorization failed, attempt HTTPS fallback
	if err != nil && !hasExplicitScheme {
		httpsEndpoint := fmt.Sprintf("https://%s/JNAP/", hostPort)
		httpsClient := linksys.NewClient()
		httpsClient.Endpoint = httpsEndpoint
		if httpsErr := httpsClient.Authorize(password); httpsErr == nil {
			client = httpsClient
			err = nil
		}
	}
	if err != nil {
		return &ConnectionResult{Success: false, Message: fmt.Sprintf("Authorization failed: %v", err)}, nil
	}

	s.mu.Lock()
	if s.connSeq != seq {
		s.mu.Unlock()
		return &ConnectionResult{Success: false, Message: "Connection attempt was superseded"}, nil
	}
	s.client = client
	s.host = host
	s.authDone = true
	s.mu.Unlock()

	return &ConnectionResult{
		Success: true,
		Host:    host,
		Message: "Connected successfully to Linksys router",
	}, nil
}

func (s *LinksysService) IsConnected() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.authDone && s.client != nil
}

func (s *LinksysService) GetConnectedHost() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.authDone && s.client != nil {
		return s.host
	}
	return ""
}

func (s *LinksysService) Disconnect() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connSeq++
	s.client = nil
	s.authDone = false
	s.host = ""
	return nil
}

// PingRouter attempts a lightweight API call to check if the router is reachable.
// Uses a 2s timeout rather than the default 10s so reconnection checks during reboots return quickly
// without causing requests to queue up.
// Returns true if the router responds with a valid JNAP OK payload, false otherwise.
func (s *LinksysService) PingRouter() bool {
	client, err := s.requireClient()
	if err != nil {
		return false
	}

	fastClient := s.fastClient
	if fastClient == nil {
		fastClient = &http.Client{
			Timeout:   2 * time.Second,
			Transport: newRouterTransport(),
		}
	}

	req, err := http.NewRequest("POST", client.Endpoint, strings.NewReader("{}"))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-JNAP-Action", "http://linksys.com/jnap/core/GetDeviceInfo")

	resp, err := fastClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return false
	}

	var jnapResp struct {
		Result string `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&jnapResp); err != nil {
		return false
	}
	return strings.EqualFold(jnapResp.Result, "OK")
}

func (s *LinksysService) GetRouterInfo() (*RouterInfoData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	info, warning := s.requestRouterInfo(client)
	if info == nil {
		return nil, fmt.Errorf("failed to fetch router info: %s", warning)
	}
	return info, nil
}

func (s *LinksysService) CheckFirmwareUpdate() (*FirmwareUpdateData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	firmware, warning := s.requestFirmwareUpdate(client)
	if firmware == nil {
		return nil, fmt.Errorf("failed to check firmware update: %s", warning)
	}
	return firmware, nil
}

func (s *LinksysService) RebootRouter() error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}

	err = client.Reboot()
	if err != nil {
		return fmt.Errorf("failed to reboot router: %w", err)
	}

	// Keep client credentials intact — the router will use the same password
	// after reboot. Mark as rebooting so PingRouter can detect the state.
	return nil
}

func (s *LinksysService) TriggerFirmwareUpdate() error {
	client, err := s.requireClient()
	if err != nil {
		return err
	}

	err = client.UpgradeFirmware()
	if err != nil {
		return fmt.Errorf("failed to trigger firmware update: %w", err)
	}

	return nil
}

func (s *LinksysService) GetConnectedDevices() ([]DeviceData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	var res struct {
		Devices []struct {
			DeviceID        string `json:"deviceID"`
			FriendlyName    string `json:"friendlyName"`
			ModelNumber     string `json:"modelNumber"`
			Manufacturer    string `json:"manufacturer"`
			OperatingSystem string `json:"operatingSystem"`
			DeviceType      string `json:"deviceType"`
			IsConnected     bool   `json:"isConnected"`
			Model           *struct {
				DeviceType   string `json:"deviceType"`
				Manufacturer string `json:"manufacturer"`
				ModelNumber  string `json:"modelNumber"`
			} `json:"model"`
			Unit *struct {
				OperatingSystem string `json:"operatingSystem"`
				SerialNumber    string `json:"serialNumber"`
			} `json:"unit"`
			KnownMACAddresses []string `json:"knownMACAddresses"`
			Connections       []struct {
				IPAddress      string `json:"ipAddress"`
				MACAddress     string `json:"macAddress"`
				ConnectionType string `json:"connectionType"`
			} `json:"connections"`
			NetworkConnections []struct {
				IPAddress      string `json:"ipAddress"`
				MACAddress     string `json:"macAddress"`
				ConnectionType string `json:"connectionType"`
			} `json:"networkConnections"`
		} `json:"devices"`
	}

	err = client.MakeRequest("devicelist/GetDevices", map[string]int{"sinceRevision": 0}, &res)
	if err != nil {
		return nil, fmt.Errorf("failed to get connected devices: %w", err)
	}

	devices := make([]DeviceData, 0, len(res.Devices))
	for _, d := range res.Devices {
		ip := ""
		mac := ""
		connType := "Unknown"

		conns := d.Connections
		if len(conns) == 0 {
			conns = d.NetworkConnections
		}

		for _, c := range conns {
			candidateIP := strings.TrimSpace(c.IPAddress)
			if isNonZeroAddress(candidateIP) {
				if ip == "" {
					ip = candidateIP
				} else if parsedCurrent := net.ParseIP(ip); parsedCurrent != nil && parsedCurrent.To4() == nil {
					if parsedCandidate := net.ParseIP(candidateIP); parsedCandidate != nil && parsedCandidate.To4() != nil {
						ip = candidateIP
					}
				}
			}
			if mac == "" && strings.TrimSpace(c.MACAddress) != "" {
				mac = normalizeMAC(c.MACAddress)
			}
			if connType == "Unknown" && c.ConnectionType != "" {
				connType = c.ConnectionType
			}
		}

		if mac == "" && len(d.KnownMACAddresses) > 0 {
			mac = normalizeMAC(d.KnownMACAddresses[0])
		}

		name := d.FriendlyName
		if name == "" {
			name = "Unknown Device"
		}

		devType := d.DeviceType
		if devType == "" && d.Model != nil {
			devType = d.Model.DeviceType
		}
		if devType == "" {
			devType = "Device"
		}

		model := d.ModelNumber
		if model == "" && d.Model != nil {
			model = d.Model.ModelNumber
		}

		manufacturer := d.Manufacturer
		if manufacturer == "" && d.Model != nil {
			manufacturer = d.Model.Manufacturer
		}

		os := d.OperatingSystem
		if os == "" && d.Unit != nil {
			os = d.Unit.OperatingSystem
		}

		isConnected := d.IsConnected
		if !isConnected && ip != "" && len(conns) > 0 {
			isConnected = true
		}

		devices = append(devices, DeviceData{
			ID:             d.DeviceID,
			FriendlyName:   name,
			DeviceType:     devType,
			IPAddress:      ip,
			MACAddress:     mac,
			IsConnected:    isConnected,
			ConnectionType: connType,
			Model:          model,
			Manufacturer:   manufacturer,
			OS:             os,
		})
	}

	return devices, nil
}

func (s *LinksysService) GetPasswordHint() (string, error) {
	client, err := s.requireClient()
	if err != nil {
		return "", err
	}

	var res struct {
		PasswordHint string `json:"passwordHint"`
	}

	err = client.MakeRequest("core/GetAdminPasswordHint", nil, &res)
	if err != nil {
		return "", fmt.Errorf("failed to get password hint: %w", err)
	}

	return res.PasswordHint, nil
}

func (s *LinksysService) ChangeAdminPassword(newPassword string, hint string) error {
	if newPassword == "" {
		return fmt.Errorf("new password cannot be empty")
	}

	client, err := s.requireClient()
	if err != nil {
		return err
	}

	payload := map[string]interface{}{
		"adminPassword": newPassword,
		"passwordHint":  hint,
	}

	var res interface{}
	// Try SetAdminPassword2 first, fallback to SetAdminPassword for older models
	err = client.MakeRequest("core/SetAdminPassword2", payload, &res)
	if err != nil && (strings.Contains(err.Error(), "UnsupportedAction") || strings.Contains(err.Error(), "InvalidAction")) {
		err = client.MakeRequest("core/SetAdminPassword", payload, &res)
	}
	if err != nil {
		return fmt.Errorf("failed to change admin password: %w", err)
	}

	// Re-authenticate on a cloned client before swapping s.client to avoid mutating
	// client.authorization concurrently with in-flight requests.
	updatedClient := *client
	if authErr := updatedClient.Authorize(newPassword); authErr != nil {
		s.mu.Lock()
		if s.client == client {
			s.client = nil
			s.authDone = false
			s.host = ""
		}
		s.mu.Unlock()
		return fmt.Errorf("password updated, but re-authentication failed: %w", authErr)
	}

	s.mu.Lock()
	if s.client == client {
		s.client = &updatedClient
	}
	s.mu.Unlock()

	return nil
}
