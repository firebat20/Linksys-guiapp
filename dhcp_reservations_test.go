package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// dhcpTestRouter simulates the LAN settings portion of a Linksys JNAP router.
type dhcpTestRouter struct {
	mu      sync.Mutex
	lan     map[string]interface{}
	wrapped bool
	setBody map[string]interface{}
}

func newDHCPTestRouter() *dhcpTestRouter {
	return &dhcpTestRouter{
		lan: map[string]interface{}{
			"ipAddress":                           "192.168.1.1",
			"networkPrefixLength":                 24,
			"hostName":                            "Linksys",
			"isDHCPEnabled":                       true,
			"minNetworkPrefixLength":              8,
			"maxNetworkPrefixLength":              30,
			"maxDHCPReservationDescriptionLength": 20,
			"minAllowedDHCPLeaseMinutes":          1,
			"maxAllowedDHCPLeaseMinutes":          10080,
			"dhcpSettings": map[string]interface{}{
				"firstClientIPAddress": "192.168.1.100",
				"lastClientIPAddress":  "192.168.1.200",
				"leaseMinutes":         1440,
				"reservations": []interface{}{
					map[string]interface{}{
						"macAddress":  "AA:BB:CC:DD:EE:01",
						"ipAddress":   "192.168.1.110",
						"description": "Printer",
					},
				},
			},
		},
	}
}

func (r *dhcpTestRouter) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		action := req.Header.Get("X-JNAP-Action")
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.HasSuffix(action, "core/CheckAdminPassword"):
			w.Write([]byte(`{"result": "OK"}`))

		case strings.HasSuffix(action, jnapGetLANSettings):
			r.mu.Lock()
			var output map[string]interface{}
			if r.wrapped {
				output = map[string]interface{}{"lanSettings": r.lan}
			} else {
				output = r.lan
			}
			payload, _ := json.Marshal(map[string]interface{}{"result": "OK", "output": output})
			r.mu.Unlock()
			w.Write(payload)

		case strings.HasSuffix(action, jnapSetLANSettings):
			var body map[string]interface{}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			r.mu.Lock()
			r.setBody = body
			if wrapped, ok := body["lanSettings"].(map[string]interface{}); ok {
				r.lan = wrapped
			} else {
				r.lan = body
			}
			r.mu.Unlock()

			w.Write([]byte(`{"result": "OK"}`))

		default:
			w.Write([]byte(`{"result": "OK"}`))
		}
	})
}

func connectToDHCPTestRouter(t *testing.T, router *dhcpTestRouter) *LinksysService {
	t.Helper()

	server := httptest.NewServer(router.handler())
	t.Cleanup(server.Close)

	service := NewLinksysService()
	service.Startup(context.Background())

	res, err := service.Connect(strings.TrimPrefix(server.URL, "http://"), "admin")
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected connect success, got %+v", res)
	}
	return service
}

func reservationByMAC(t *testing.T, data *LANSettingsData, macAddress string) *DHCPReservationData {
	t.Helper()

	for index := range data.Reservations {
		if strings.EqualFold(data.Reservations[index].MACAddress, macAddress) {
			return &data.Reservations[index]
		}
	}
	return nil
}

func TestDHCPReservationLifecycle(t *testing.T) {
	router := newDHCPTestRouter()
	service := connectToDHCPTestRouter(t, router)

	initial, err := service.GetDHCPReservations()
	if err != nil {
		t.Fatalf("GetDHCPReservations failed: %v", err)
	}
	if initial.DHCPFirstIPAddress != "192.168.1.100" || initial.DHCPLastIPAddress != "192.168.1.200" {
		t.Errorf("unexpected DHCP pool: %+v", initial)
	}
	if initial.MaxReservationDescriptionLength != 20 {
		t.Errorf("expected description limit 20, got %d", initial.MaxReservationDescriptionLength)
	}
	if len(initial.Reservations) != 1 || initial.Reservations[0].Description != "Printer" {
		t.Fatalf("unexpected initial reservations: %+v", initial.Reservations)
	}

	added, err := service.AddDHCPReservation("aa-bb-cc-dd-ee-02", "192.168.1.120", "  Laptop  ")
	if err != nil {
		t.Fatalf("AddDHCPReservation failed: %v", err)
	}
	if len(added.Reservations) != 2 {
		t.Fatalf("expected 2 reservations, got %d", len(added.Reservations))
	}
	laptop := reservationByMAC(t, added, "AA:BB:CC:DD:EE:02")
	if laptop == nil {
		t.Fatalf("added reservation not found: %+v", added.Reservations)
	}
	if laptop.IPAddress != "192.168.1.120" || laptop.Description != "Laptop" {
		t.Errorf("unexpected added reservation: %+v", laptop)
	}

	// The mock router must receive the whole LAN object with writable fields
	// preserved and read-only capability fields removed.
	if hostName, _ := router.lan["hostName"].(string); hostName != "Linksys" {
		t.Errorf("expected hostName to be preserved, got %q", hostName)
	}
	for _, field := range readOnlyLANFields {
		if _, ok := router.lan[field]; ok {
			t.Errorf("expected read-only field %q to be stripped", field)
		}
	}
	if _, ok := router.lan["dhcpSettings"]; !ok {
		t.Errorf("expected dhcpSettings to be preserved")
	}

	updated, err := service.UpdateDHCPReservation("AA:BB:CC:DD:EE:02", "AA:BB:CC:DD:EE:03", "192.168.1.121", "Work laptop")
	if err != nil {
		t.Fatalf("UpdateDHCPReservation failed: %v", err)
	}
	laptop = reservationByMAC(t, updated, "AA:BB:CC:DD:EE:03")
	if laptop == nil {
		t.Fatalf("updated reservation not found: %+v", updated.Reservations)
	}
	if laptop.IPAddress != "192.168.1.121" || laptop.Description != "Work laptop" {
		t.Errorf("unexpected updated reservation: %+v", laptop)
	}
	if reservationByMAC(t, updated, "AA:BB:CC:DD:EE:02") != nil {
		t.Errorf("original MAC address should no longer be reserved")
	}

	deleted, err := service.DeleteDHCPReservation("AA:BB:CC:DD:EE:01")
	if err != nil {
		t.Fatalf("DeleteDHCPReservation failed: %v", err)
	}
	if len(deleted.Reservations) != 1 || deleted.Reservations[0].MACAddress != "AA:BB:CC:DD:EE:03" {
		t.Errorf("unexpected reservations after delete: %+v", deleted.Reservations)
	}

	if _, err := service.DeleteDHCPReservation("AA:BB:CC:DD:EE:FF"); err == nil {
		t.Errorf("expected deleting an unknown reservation to fail")
	}
}

func TestDHCPReservationValidation(t *testing.T) {
	router := newDHCPTestRouter()
	service := connectToDHCPTestRouter(t, router)

	tests := []struct {
		name        string
		mac         string
		ip          string
		description string
		want        string
	}{
		{"invalid MAC", "not-a-mac", "192.168.1.130", "", "invalid MAC"},
		{"eui64 MAC", "AA:BB:CC:DD:EE:FF:00:11", "192.168.1.130", "", "48-bit Ethernet MAC"},
		{"zero MAC", "00:00:00:00:00:00", "192.168.1.130", "", "special MAC"},
		{"broadcast MAC", "FF:FF:FF:FF:FF:FF", "192.168.1.130", "", "special MAC"},
		{"invalid IP", "AA:BB:CC:DD:EE:10", "999.1.1.1", "", "invalid IPv4"},
		{"IPv6 IP", "AA:BB:CC:DD:EE:10", "fd00::1", "", "invalid IPv4"},
		{"outside subnet", "AA:BB:CC:DD:EE:10", "10.0.0.50", "", "outside the router's subnet"},
		{"network IP", "AA:BB:CC:DD:EE:10", "192.168.1.0", "", "cannot reserve the subnet network address"},
		{"broadcast IP", "AA:BB:CC:DD:EE:10", "192.168.1.255", "", "cannot reserve the subnet broadcast address"},
		{"outside pool", "AA:BB:CC:DD:EE:10", "192.168.1.50", "", "inside the DHCP pool"},
		{"router IP", "AA:BB:CC:DD:EE:10", "192.168.1.1", "", "cannot reserve the router's own IP address"},
		{"description too long", "AA:BB:CC:DD:EE:10", "192.168.1.130", strings.Repeat("x", 21), "20 characters or fewer"},
		{"duplicate MAC", "aa:bb:cc:dd:ee:01", "192.168.1.130", "", "already exists"},
		{"duplicate IP", "AA:BB:CC:DD:EE:10", "192.168.1.110", "", "already reserved"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.AddDHCPReservation(test.mac, test.ip, test.description)
			if err == nil {
				t.Fatalf("expected an error")
			}
			if !strings.Contains(err.Error(), test.want) {
				t.Errorf("expected error containing %q, got %v", test.want, err)
			}
		})
	}

	// Update must ignore the reservation being edited when checking conflicts.
	updated, err := service.UpdateDHCPReservation("AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01", "192.168.1.110", "Printer 2")
	if err != nil {
		t.Fatalf("updating a reservation with unchanged MAC/IP failed: %v", err)
	}
	if printer := reservationByMAC(t, updated, "AA:BB:CC:DD:EE:01"); printer == nil || printer.Description != "Printer 2" {
		t.Errorf("unexpected reservation: %+v", updated.Reservations)
	}

	if _, err := service.AddDHCPReservation("AA:BB:CC:DD:EE:30", "192.168.1.150", "NAS"); err != nil {
		t.Fatalf("AddDHCPReservation failed: %v", err)
	}
	if _, err := service.UpdateDHCPReservation("AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01", "192.168.1.150", ""); err == nil {
		t.Errorf("expected update to reject a duplicate IP address")
	}

	if _, err := service.UpdateDHCPReservation("AA:BB:CC:DD:EE:99", "AA:BB:CC:DD:EE:99", "192.168.1.150", ""); err == nil {
		t.Errorf("expected updating an unknown reservation to fail")
	}
}

func TestDHCPReservationWrappedEnvelope(t *testing.T) {
	router := newDHCPTestRouter()
	router.wrapped = true
	service := connectToDHCPTestRouter(t, router)

	initial, err := service.GetDHCPReservations()
	if err != nil {
		t.Fatalf("GetDHCPReservations failed: %v", err)
	}
	if initial.IPAddress != "192.168.1.1" {
		t.Errorf("expected wrapped LAN settings to be parsed, got %+v", initial)
	}

	if _, err := service.AddDHCPReservation("AA:BB:CC:DD:EE:20", "192.168.1.140", "NAS"); err != nil {
		t.Fatalf("AddDHCPReservation failed: %v", err)
	}

	if _, ok := router.setBody["lanSettings"]; !ok {
		t.Fatalf("expected SetLANSettings to preserve the lanSettings envelope, got %+v", router.setBody)
	}
	if _, ok := router.lan["dhcpSettings"]; !ok {
		t.Errorf("expected dhcpSettings inside the wrapped payload")
	}
}

func TestDHCPReservationsRequireConnection(t *testing.T) {
	service := NewLinksysService()
	service.Startup(context.Background())

	if _, err := service.GetDHCPReservations(); err == nil {
		t.Errorf("expected GetDHCPReservations to fail when not connected")
	}
	if _, err := service.AddDHCPReservation("AA:BB:CC:DD:EE:01", "192.168.1.120", ""); err == nil {
		t.Errorf("expected AddDHCPReservation to fail when not connected")
	}
}

func TestValidateReservationInputNilData(t *testing.T) {
	mac, ip, desc, err := validateReservationInput("aa:bb:cc:dd:ee:ff", "192.168.1.50", "Test Device", nil)
	if err != nil {
		t.Fatalf("expected nil data validation to succeed without panic, got: %v", err)
	}
	if mac != "AA:BB:CC:DD:EE:FF" || ip != "192.168.1.50" || desc != "Test Device" {
		t.Errorf("unexpected output: %s, %s, %s", mac, ip, desc)
	}
}
