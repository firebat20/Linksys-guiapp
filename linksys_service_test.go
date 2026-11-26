package main

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestConnectValidation(t *testing.T) {
	service := NewLinksysService()
	service.Startup(context.Background())

	// Test empty host
	res, err := service.Connect("", "password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Success || res.Message != "Host/IP address is required" {
		t.Errorf("expected host required error, got: %+v", res)
	}

	// Test empty password
	res, err = service.Connect("192.168.1.1", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Success || res.Message != "Password is required" {
		t.Errorf("expected password required error, got: %+v", res)
	}

	// Test missing host after scheme
	res, err = service.Connect("http://", "password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Success || !strings.Contains(res.Message, "Invalid host format") {
		t.Errorf("expected invalid host error, got: %+v", res)
	}

	// Test unsupported scheme
	res, err = service.Connect("ftp://192.168.1.1", "password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Success || !strings.Contains(res.Message, "Invalid host scheme") {
		t.Errorf("expected invalid scheme error, got: %+v", res)
	}
}

func TestDisconnectAndState(t *testing.T) {
	service := NewLinksysService()
	service.Startup(context.Background())

	if service.IsConnected() {
		t.Errorf("expected not connected initially")
	}
	if host := service.GetConnectedHost(); host != "" {
		t.Errorf("expected empty connected host, got %q", host)
	}

	err := service.Disconnect()
	if err != nil {
		t.Errorf("expected nil error from Disconnect, got %v", err)
	}
}

func TestMockJNAPServer(t *testing.T) {
	// Mock JNAP router server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.Header.Get("X-JNAP-Action")
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.HasSuffix(action, "core/CheckAdminPassword"):
			auth := r.Header.Get("X-JNAP-Authorization")
			if auth == "" {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"result": "ErrorUnauthorized"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"result": "OK"}`))

		case strings.HasSuffix(action, "core/GetDeviceInfo"):
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"result": "OK",
				"output": {
					"modelNumber": "WRT3200ACM",
					"serialNumber": "16J10603700123",
					"hardwareVersion": "v1.0",
					"firmwareVersion": "1.0.8.187297",
					"firmwareDate": "2020-04-10",
					"manufacturer": "Linksys",
					"macAddress": "C4:41:1E:AA:BB:CC"
				}
			}`))

		case strings.HasSuffix(action, "core/GetAdminPasswordHint"):
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"result": "OK",
				"output": {
					"passwordHint": "MySecretHint"
				}
			}`))

		case strings.HasSuffix(action, "devicelist/GetDevices"):
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"result": "OK",
				"output": {
					"devices": [
						{
							"deviceID": "uuid-1",
							"friendlyName": "MacBook Pro",
							"deviceType": "Computer",
							"isConnected": true,
							"connections": [
								{
									"ipAddress": "192.168.1.105",
									"macAddress": "AA:BB:CC:DD:EE:01",
									"connectionType": "Wireless 5GHz"
								}
							]
						}
					]
				}
			}`))

		default:
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"result": "OK"}`))
		}
	}))
	defer server.Close()

	service := NewLinksysService()
	service.Startup(context.Background())

	// Connect to mock server
	host := strings.TrimPrefix(server.URL, "http://")
	res, err := service.Connect(host, "admin")
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected connect success, got %+v", res)
	}

	if !service.IsConnected() {
		t.Errorf("expected IsConnected to be true")
	}

	if h := service.GetConnectedHost(); h != host {
		t.Errorf("expected host %q, got %q", host, h)
	}

	// Test PingRouter
	if !service.PingRouter() {
		t.Errorf("expected PingRouter to succeed on mock server")
	}

	// Test GetRouterInfo
	info, err := service.GetRouterInfo()
	if err != nil {
		t.Fatalf("GetRouterInfo failed: %v", err)
	}
	if info.ModelNumber != "WRT3200ACM" {
		t.Errorf("expected model WRT3200ACM, got %s", info.ModelNumber)
	}

	// Test GetPasswordHint
	hint, err := service.GetPasswordHint()
	if err != nil {
		t.Fatalf("GetPasswordHint failed: %v", err)
	}
	if hint != "MySecretHint" {
		t.Errorf("expected hint MySecretHint, got %s", hint)
	}

	// Test GetConnectedDevices
	devices, err := service.GetConnectedDevices()
	if err != nil {
		t.Fatalf("GetConnectedDevices failed: %v", err)
	}
	if len(devices) != 1 || devices[0].FriendlyName != "MacBook Pro" {
		t.Errorf("unexpected devices result: %+v", devices)
	}

	// Test Disconnect
	err = service.Disconnect()
	if err != nil {
		t.Errorf("Disconnect failed: %v", err)
	}
	if service.IsConnected() {
		t.Errorf("expected IsConnected to be false after Disconnect")
	}
}

func TestGetConnectedDevicesNested(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.Header.Get("X-JNAP-Action")
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.HasSuffix(action, "core/CheckAdminPassword"):
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"result": "OK"}`))

		case strings.HasSuffix(action, "devicelist/GetDevices"):
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"result": "OK",
				"output": {
					"devices": [
						{
							"deviceID": "uuid-apple-phone",
							"friendlyName": "Alex's iPhone",
							"model": {
								"deviceType": "SmartPhone",
								"manufacturer": "Apple Inc.",
								"modelNumber": "iPhone 15 Pro"
							},
							"unit": {
								"operatingSystem": "iOS 18"
							},
							"knownMACAddresses": ["aa:bb:cc:11:22:33"],
							"connections": [
								{
									"ipAddress": "",
									"macAddress": "",
									"connectionType": ""
								},
								{
									"ipAddress": "192.168.1.155",
									"macAddress": "aa:bb:cc:11:22:33",
									"connectionType": "Wireless 5GHz"
								}
							]
						}
					]
				}
			}`))

		default:
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"result": "OK"}`))
		}
	}))
	defer server.Close()

	service := NewLinksysService()
	host := strings.TrimPrefix(server.URL, "http://")
	_, err := service.Connect(host, "admin")
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	devices, err := service.GetConnectedDevices()
	if err != nil {
		t.Fatalf("GetConnectedDevices failed: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}

	d := devices[0]
	if d.FriendlyName != "Alex's iPhone" {
		t.Errorf("expected name Alex's iPhone, got %s", d.FriendlyName)
	}
	if d.DeviceType != "SmartPhone" {
		t.Errorf("expected DeviceType SmartPhone, got %s", d.DeviceType)
	}
	if d.Manufacturer != "Apple Inc." {
		t.Errorf("expected Manufacturer Apple Inc., got %s", d.Manufacturer)
	}
	if d.Model != "iPhone 15 Pro" {
		t.Errorf("expected Model iPhone 15 Pro, got %s", d.Model)
	}
	if d.OS != "iOS 18" {
		t.Errorf("expected OS iOS 18, got %s", d.OS)
	}
	if d.IPAddress != "192.168.1.155" {
		t.Errorf("expected IP 192.168.1.155, got %s", d.IPAddress)
	}
	if d.MACAddress != "AA:BB:CC:11:22:33" {
		t.Errorf("expected normalized MAC AA:BB:CC:11:22:33, got %s", d.MACAddress)
	}
	if !d.IsConnected {
		t.Errorf("expected device to be connected")
	}
}

func TestPingRouterRejectsNonOKAndHTML(t *testing.T) {
	var mode atomic.Int32 // 0=OK, 1=JNAP error, 2=HTML
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.Header.Get("X-JNAP-Action")
		if strings.HasSuffix(action, "core/CheckAdminPassword") {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"result": "OK"}`))
			return
		}
		switch mode.Load() {
		case 0:
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"result": "OK", "output": {}}`))
		case 1:
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"result": "_ErrorBooting"}`))
		case 2:
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`<html><body>Booting...</body></html>`))
		}
	}))
	defer server.Close()

	service := NewLinksysService()
	host := strings.TrimPrefix(server.URL, "http://")
	res, err := service.Connect("HTTP://"+host, "admin")
	if err != nil || !res.Success {
		t.Fatalf("expected uppercase HTTP scheme connect to succeed, got res=%+v err=%v", res, err)
	}

	if !service.PingRouter() {
		t.Errorf("expected PingRouter to return true for OK JSON")
	}
	mode.Store(1)
	if service.PingRouter() {
		t.Errorf("expected PingRouter to return false for JNAP error result")
	}
	mode.Store(2)
	if service.PingRouter() {
		t.Errorf("expected PingRouter to return false for HTML 200 response")
	}
}

func TestChangeAdminPasswordFallbackAndReauth(t *testing.T) {
	var currentPass atomic.Value
	currentPass.Store("admin")
	var usedLegacyAction atomic.Bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.Header.Get("X-JNAP-Action")
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.HasSuffix(action, "core/CheckAdminPassword"):
			authHeader := r.Header.Get("X-JNAP-Authorization")
			expected := "Basic " + base64.StdEncoding.EncodeToString([]byte("admin:"+currentPass.Load().(string)))
			if authHeader != expected {
				w.Write([]byte(`{"result": "ErrorUnauthorized"}`))
				return
			}
			w.Write([]byte(`{"result": "OK"}`))

		case strings.HasSuffix(action, "core/SetAdminPassword2"):
			w.Write([]byte(`{"result": "_ErrorUnsupportedAction"}`))

		case strings.HasSuffix(action, "core/SetAdminPassword"):
			usedLegacyAction.Store(true)
			currentPass.Store("NewSecret123!")
			w.Write([]byte(`{"result": "OK"}`))

		default:
			w.Write([]byte(`{"result": "OK"}`))
		}
	}))
	defer server.Close()

	service := NewLinksysService()
	host := strings.TrimPrefix(server.URL, "http://")
	res, err := service.Connect(host, "admin")
	if err != nil || !res.Success {
		t.Fatalf("Connect failed: res=%+v err=%v", res, err)
	}

	if err := service.ChangeAdminPassword("", "hint"); err == nil {
		t.Errorf("expected empty password to be rejected")
	}

	if err := service.ChangeAdminPassword("NewSecret123!", "new-hint"); err != nil {
		t.Fatalf("ChangeAdminPassword failed: %v", err)
	}
	if !usedLegacyAction.Load() {
		t.Errorf("expected fallback to core/SetAdminPassword")
	}
	if !service.IsConnected() {
		t.Errorf("expected service to remain connected after password change")
	}
}

func TestGetConnectedDevicesEmptyAndPrefersIPv4(t *testing.T) {
	var empty atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.Header.Get("X-JNAP-Action")
		w.Header().Set("Content-Type", "application/json")

		if strings.HasSuffix(action, "core/CheckAdminPassword") {
			w.Write([]byte(`{"result": "OK"}`))
			return
		}
		if strings.HasSuffix(action, "devicelist/GetDevices") {
			if empty.Load() {
				w.Write([]byte(`{"result": "OK", "output": {"devices": []}}`))
				return
			}
			w.Write([]byte(`{
				"result": "OK",
				"output": {
					"devices": [
						{
							"deviceID": "uuid-dual",
							"friendlyName": "Workstation",
							"isConnected": true,
							"connections": [
								{"ipAddress": "fe80::1", "macAddress": "AA:BB:CC:DD:EE:10", "connectionType": "Ethernet"},
								{"ipAddress": "192.168.1.42", "macAddress": "AA:BB:CC:DD:EE:10", "connectionType": "Ethernet"}
							]
						}
					]
				}
			}`))
		}
	}))
	defer server.Close()

	service := NewLinksysService()
	if _, err := service.Connect(strings.TrimPrefix(server.URL, "http://"), "admin"); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	devices, err := service.GetConnectedDevices()
	if err != nil {
		t.Fatalf("GetConnectedDevices failed: %v", err)
	}
	if len(devices) != 1 || devices[0].IPAddress != "192.168.1.42" {
		t.Errorf("expected IPv4 address 192.168.1.42 to be preferred, got %+v", devices)
	}

	empty.Store(true)
	devices, err = service.GetConnectedDevices()
	if err != nil {
		t.Fatalf("GetConnectedDevices empty failed: %v", err)
	}
	if devices == nil || len(devices) != 0 {
		t.Errorf("expected non-nil empty slice, got %#v", devices)
	}
}

