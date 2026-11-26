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

type overviewTestRouter struct {
	mu sync.Mutex

	batchMode       string // "", "all-ok", "transaction-fails", "partial"
	wanAction       string
	statsAction     string
	batchActions    []string
	directActions   []string
	batchRequestRaw []map[string]interface{}
}

func newOverviewTestRouter() *overviewTestRouter {
	return &overviewTestRouter{
		batchMode:   "all-ok",
		wanAction:   "router/GetWANStatus3",
		statsAction: "diagnostics/GetSystemStats2",
	}
}

func overviewRouterOutput(action string) (json.RawMessage, bool) {
	switch {
	case strings.HasSuffix(action, "core/GetDeviceInfo"):
		return json.RawMessage(`{
			"modelNumber": "WRT3200ACM",
			"serialNumber": "16J10603700123",
			"hardwareVersion": "v1.0",
			"firmwareVersion": "1.0.8.187297",
			"firmwareDate": "2020-04-10",
			"manufacturer": "Linksys",
			"macAddress": "C4:41:1E:AA:BB:CC"
		}`), true

	case strings.HasSuffix(action, "firmwareupdate/GetFirmwareUpdateStatus"):
		return json.RawMessage(`{
			"lastSuccessfulCheckTime": "2026-11-09T12:00:00Z",
			"availableUpdate": {
				"firmwareVersion": "1.0.9",
				"firmwareDate": "2026-10-01",
				"description": "Security fixes"
			}
		}`), true

	case strings.Contains(action, "router/GetWANStatus"):
		return json.RawMessage(`{
			"wanStatus": "Connected",
			"wanIPv6Status": "Connected",
			"detectedWANType": "DHCP",
			"macAddress": "02:11:22:00:00:FF",
			"wanConnection": {
				"wanType": "DHCP",
				"ipAddress": "203.0.113.10",
				"networkPrefixLength": 24,
				"gateway": "203.0.113.1",
				"mtu": 1500,
				"dhcpLeaseMinutes": 1440,
				"dnsServer1": "203.0.113.2",
				"dnsServer2": "203.0.113.3",
				"dnsServer3": "203.0.113.4"
			},
			"wanIPv6Connection": {
				"wanType": "DHCPv6",
				"networkInfo": {
					"ipAddress": "2001:db8::10",
					"gateway": "2001:db8::1"
				}
			}
		}`), true

	case strings.Contains(action, "diagnostics/GetSystemStats"):
		return json.RawMessage(`{
			"uptimeSeconds": 90000,
			"CPULoad": 12,
			"MemoryLoad": 41
		}`), true
	}
	return nil, false
}

func (r *overviewTestRouter) supportedAction(requested, configured string) bool {
	return requested == configured
}

func (r *overviewTestRouter) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		action := req.Header.Get("X-JNAP-Action")
		w.Header().Set("Content-Type", "application/json")

		if strings.HasSuffix(action, "core/CheckAdminPassword") {
			w.Write([]byte(`{"result": "OK"}`))
			return
		}

		if strings.HasSuffix(action, "core/Transaction") {
			var requests []map[string]interface{}
			if err := json.NewDecoder(req.Body).Decode(&requests); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			r.mu.Lock()
			r.batchActions = r.batchActions[:0]
			for _, item := range requests {
				actionValue, _ := item["action"].(string)
				r.batchActions = append(r.batchActions, actionValue)
			}
			r.batchRequestRaw = requests
			mode := r.batchMode
			wanAction := r.wanAction
			statsAction := r.statsAction
			r.mu.Unlock()

			if mode == "transaction-fails" {
				w.Write([]byte(`{"result": "_ErrorUnsupportedAction"}`))
				return
			}

			responses := make([]map[string]interface{}, 0, len(requests))
			for _, item := range requests {
				actionValue, _ := item["action"].(string)

				// Mesh firmware sometimes aborts individual children of a
				// transaction without refusing the whole request.
				if mode == "metadata-fails" && (strings.HasSuffix(actionValue, "core/GetDeviceInfo") || strings.HasSuffix(actionValue, "firmwareupdate/GetFirmwareUpdateStatus")) {
					responses = append(responses, map[string]interface{}{"result": "_ErrorUnauthorized"})
					continue
				}
				if strings.HasSuffix(actionValue, "router/GetWANStatus3") && wanAction != "router/GetWANStatus3" {
					responses = append(responses, map[string]interface{}{"result": "_ErrorUnsupportedAction"})
					continue
				}
				if strings.HasSuffix(actionValue, "diagnostics/GetSystemStats2") && statsAction != "diagnostics/GetSystemStats2" {
					responses = append(responses, map[string]interface{}{"result": "_ErrorUnsupportedAction"})
					continue
				}

				output, ok := overviewRouterOutput(actionValue)
				if !ok {
					responses = append(responses, map[string]interface{}{"result": "_ErrorUnsupportedAction"})
					continue
				}
				responses = append(responses, map[string]interface{}{"result": "OK", "output": output})
			}

			payload, _ := json.Marshal(map[string]interface{}{
				"result": "OK",
				"output": map[string]interface{}{"responses": responses},
			})
			w.Write(payload)
			return
		}

		r.mu.Lock()
		r.directActions = append(r.directActions, action)
		mode := r.batchMode
		wanAction := r.wanAction
		statsAction := r.statsAction
		r.mu.Unlock()

		if mode == "transaction-fails" {
			// Direct requests are expected to work even when batching is refused.
		}

		if strings.HasSuffix(action, "router/GetWANStatus3") && wanAction != "router/GetWANStatus3" {
			w.Write([]byte(`{"result": "_ErrorUnsupportedAction"}`))
			return
		}
		if strings.HasSuffix(action, "router/GetWANStatus2") && wanAction != "router/GetWANStatus2" {
			w.Write([]byte(`{"result": "_ErrorUnsupportedAction"}`))
			return
		}
		if strings.HasSuffix(action, "diagnostics/GetSystemStats2") && statsAction != "diagnostics/GetSystemStats2" {
			w.Write([]byte(`{"result": "_ErrorUnsupportedAction"}`))
			return
		}
		if strings.HasSuffix(action, "diagnostics/GetSystemStats") && statsAction != "diagnostics/GetSystemStats" {
			w.Write([]byte(`{"result": "_ErrorUnsupportedAction"}`))
			return
		}

		output, ok := overviewRouterOutput(action)
		if !ok {
			w.Write([]byte(`{"result": "_ErrorUnsupportedAction"}`))
			return
		}
		payload, _ := json.Marshal(map[string]interface{}{"result": "OK", "output": output})
		w.Write(payload)
	})
}

func connectToOverviewTestRouter(t *testing.T, router *overviewTestRouter) *LinksysService {
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

func TestGetRouterOverviewUsesTransaction(t *testing.T) {
	router := newOverviewTestRouter()
	service := connectToOverviewTestRouter(t, router)

	overview, err := service.GetRouterOverview()
	if err != nil {
		t.Fatalf("GetRouterOverview failed: %v", err)
	}

	router.mu.Lock()
	batchCount := len(router.batchActions)
	directCount := len(router.directActions)
	batchActions := append([]string(nil), router.batchActions...)
	requestCount := len(router.batchRequestRaw)
	router.mu.Unlock()

	if batchCount != 4 || requestCount != 4 {
		t.Errorf("expected one transaction with 4 actions, got %d actions in %d requests", batchCount, requestCount)
	}
	if directCount != 0 {
		t.Errorf("expected no direct action calls, got %v", router.directActions)
	}
	for _, action := range batchActions {
		if !strings.HasPrefix(action, jnapActionPrefix) {
			t.Errorf("expected fully-qualified JNAP action, got %q", action)
		}
	}

	if overview.Info == nil || overview.Info.ModelNumber != "WRT3200ACM" {
		t.Errorf("unexpected router info: %+v", overview.Info)
	}
	if overview.Firmware == nil || !overview.Firmware.UpdateAvailable || overview.Firmware.NewVersion != "1.0.9" {
		t.Errorf("unexpected firmware data: %+v", overview.Firmware)
	}
	if overview.WAN == nil {
		t.Fatalf("expected WAN data")
	}
	if !overview.WAN.IsConnected || overview.WAN.IPAddress != "203.0.113.10" {
		t.Errorf("unexpected WAN status: %+v", overview.WAN)
	}
	if overview.WAN.WANType != "DHCP" || overview.WAN.Gateway != "203.0.113.1" {
		t.Errorf("unexpected WAN connection details: %+v", overview.WAN)
	}
	if len(overview.WAN.DNSServers) != 3 || overview.WAN.DNS2 != "203.0.113.3" {
		t.Errorf("unexpected DNS data: %+v", overview.WAN)
	}
	if overview.WAN.IPv6Address != "2001:db8::10" || overview.WAN.IPv6Gateway != "2001:db8::1" {
		t.Errorf("unexpected IPv6 data: %+v", overview.WAN)
	}
	if overview.Health == nil || overview.Health.UptimeSeconds != 90000 {
		t.Errorf("unexpected health data: %+v", overview.Health)
	}
	if overview.Health.CPULoadPercent == nil || *overview.Health.CPULoadPercent != 12 {
		t.Errorf("unexpected CPU load: %+v", overview.Health.CPULoadPercent)
	}
	if overview.Health.MemoryLoadPercent == nil || *overview.Health.MemoryLoadPercent != 41 {
		t.Errorf("unexpected memory load: %+v", overview.Health.MemoryLoadPercent)
	}
	if len(overview.Warnings) != 0 {
		t.Errorf("expected no warnings, got %v", overview.Warnings)
	}
}

func TestGetRouterOverviewFallsBackWhenTransactionFails(t *testing.T) {
	router := newOverviewTestRouter()
	router.batchMode = "transaction-fails"
	service := connectToOverviewTestRouter(t, router)

	overview, err := service.GetRouterOverview()
	if err != nil {
		t.Fatalf("GetRouterOverview failed: %v", err)
	}

	router.mu.Lock()
	directActions := append([]string(nil), router.directActions...)
	router.mu.Unlock()

	if len(directActions) != 4 {
		t.Errorf("expected 4 fallback requests, got %v", directActions)
	}
	if overview.Info == nil || overview.WAN == nil || overview.Health == nil {
		t.Errorf("expected fallback data to be populated: %+v", overview)
	}
}

func TestGetRouterOverviewRetriesAbortedMetadataChildren(t *testing.T) {
	router := newOverviewTestRouter()
	router.batchMode = "metadata-fails"
	service := connectToOverviewTestRouter(t, router)

	overview, err := service.GetRouterOverview()
	if err != nil {
		t.Fatalf("GetRouterOverview failed: %v", err)
	}

	router.mu.Lock()
	directActions := append([]string(nil), router.directActions...)
	router.mu.Unlock()

	if len(directActions) != 2 {
		t.Errorf("expected info and firmware to be retried directly, got %v", directActions)
	}
	if overview.Info == nil || overview.Info.ModelNumber != "WRT3200ACM" {
		t.Errorf("expected router info retry to succeed: %+v", overview.Info)
	}
	if overview.Firmware == nil || !overview.Firmware.UpdateAvailable {
		t.Errorf("expected firmware retry to succeed: %+v", overview.Firmware)
	}
	if overview.WAN == nil || overview.Health == nil {
		t.Errorf("expected batched WAN and health data: %+v", overview)
	}
}

func TestGetRouterOverviewFallsBackToOlderWANAndStatsActions(t *testing.T) {
	router := newOverviewTestRouter()
	router.batchMode = "partial"
	router.wanAction = "router/GetWANStatus2"
	router.statsAction = "diagnostics/GetSystemStats"
	service := connectToOverviewTestRouter(t, router)

	overview, err := service.GetRouterOverview()
	if err != nil {
		t.Fatalf("GetRouterOverview failed: %v", err)
	}

	if overview.WAN == nil || overview.WAN.IPAddress != "203.0.113.10" {
		t.Errorf("expected WAN fallback data: %+v", overview.WAN)
	}
	if overview.Health == nil || overview.Health.UptimeSeconds != 90000 {
		t.Errorf("expected system stats fallback data: %+v", overview.Health)
	}
	if len(overview.Warnings) != 0 {
		t.Errorf("expected fallback to succeed without warnings, got %v", overview.Warnings)
	}
}

func TestParseSystemStatsNestedDeviceRows(t *testing.T) {
	data, err := parseSystemStatsOutput(json.RawMessage(`{
		"deviceStats": [
			{"deviceUUID": "node-1", "uptimeSeconds": 3600, "CPULoad": 25.5, "MemoryLoad": 50}
		]
	}`))
	if err != nil {
		t.Fatalf("parseSystemStatsOutput failed: %v", err)
	}
	if data.UptimeSeconds != 3600 {
		t.Errorf("expected uptime 3600, got %d", data.UptimeSeconds)
	}
	if data.CPULoadPercent == nil || *data.CPULoadPercent != 25.5 {
		t.Errorf("unexpected CPU load: %+v", data.CPULoadPercent)
	}
	if data.MemoryLoadPercent == nil || *data.MemoryLoadPercent != 50 {
		t.Errorf("unexpected memory load: %+v", data.MemoryLoadPercent)
	}
}

func TestParseSystemStatsNestedDictionary(t *testing.T) {
	data, err := parseSystemStatsOutput(json.RawMessage(`{
		"systemStats": {
			"uptime": 7200,
			"cpuUtilization": 18,
			"memoryUtilization": 42
		}
	}`))
	if err != nil {
		t.Fatalf("parseSystemStatsOutput failed: %v", err)
	}
	if data.UptimeSeconds != 7200 {
		t.Errorf("expected uptime 7200, got %d", data.UptimeSeconds)
	}
	if data.CPULoadPercent == nil || *data.CPULoadPercent != 18 {
		t.Errorf("unexpected CPU load: %+v", data.CPULoadPercent)
	}
	if data.MemoryLoadPercent == nil || *data.MemoryLoadPercent != 42 {
		t.Errorf("unexpected memory load: %+v", data.MemoryLoadPercent)
	}
}

func TestParseSystemStatsTotalFreeMemory(t *testing.T) {
	data, err := parseSystemStatsOutput(json.RawMessage(`{
		"systemStats": {
			"uptime": 3600,
			"CPULoad": 25,
			"totalMemory": 512000,
			"freeMemory": 256000
		}
	}`))
	if err != nil {
		t.Fatalf("parseSystemStatsOutput failed: %v", err)
	}
	if data.MemoryLoadPercent == nil || *data.MemoryLoadPercent != 50 {
		t.Errorf("expected 50%% calculated memory load, got %+v", data.MemoryLoadPercent)
	}
}

func TestParseWANStatusHandlesMissingOptionalFields(t *testing.T) {
	data, err := parseWANStatusOutput(json.RawMessage(`{
		"wanStatus": "Disconnected",
		"detectedWANType": "DHCP",
		"wanConnection": {
			"ipAddress": "0.0.0.0",
			"gateway": "0.0.0.0"
		},
		"wanIPv6Connection": {
			"networkInfo": {
				"ipAddress": "::",
				"gateway": "::"
			}
		}
	}`))
	if err != nil {
		t.Fatalf("parseWANStatusOutput failed: %v", err)
	}
	if data.IsConnected {
		t.Errorf("expected WAN to be disconnected")
	}
	if data.WANType != "DHCP" || data.IPAddress != "" || data.Gateway != "" || data.IPv6Address != "" || data.IPv6Gateway != "" {
		t.Errorf("unexpected WAN data with placeholder zero addresses: %+v", data)
	}
}

func TestOverviewHelpersRequireConnection(t *testing.T) {
	service := NewLinksysService()
	service.Startup(context.Background())

	if _, err := service.GetWANStatus(); err == nil {
		t.Errorf("expected GetWANStatus to fail when not connected")
	}
	if _, err := service.GetSystemHealth(); err == nil {
		t.Errorf("expected GetSystemHealth to fail when not connected")
	}
	if _, err := service.GetRouterOverview(); err == nil {
		t.Errorf("expected GetRouterOverview to fail when not connected")
	}
}
