package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/reujab/linksys"
)

// WANStatusData is the internet connection information shown on the overview.
type WANStatusData struct {
	Status              string   `json:"status"`
	IsConnected         bool     `json:"isConnected"`
	WANType             string   `json:"wanType"`
	IPAddress           string   `json:"ipAddress"`
	NetworkPrefixLength int      `json:"networkPrefixLength"`
	Gateway             string   `json:"gateway"`
	MTU                 int      `json:"mtu"`
	DHCPLeaseMinutes    int      `json:"dhcpLeaseMinutes"`
	DNS1                string   `json:"dns1"`
	DNS2                string   `json:"dns2"`
	DNS3                string   `json:"dns3"`
	MACAddress          string   `json:"macAddress"`
	IPv6Status          string   `json:"ipv6Status"`
	IPv6Address         string   `json:"ipv6Address"`
	IPv6Gateway         string   `json:"ipv6Gateway"`
	DNSServers          []string `json:"dnsServers"`
}

// SystemHealthData contains the router resource values supported by the
// firmware. Optional values are nil when the router does not report them.
type SystemHealthData struct {
	UptimeSeconds     int64    `json:"uptimeSeconds"`
	CPULoadPercent    *float64 `json:"cpuLoadPercent"`
	MemoryLoadPercent *float64 `json:"memoryLoadPercent"`
}

// RouterOverviewData is returned by a single batched JNAP transaction.
type RouterOverviewData struct {
	Info     *RouterInfoData     `json:"info"`
	Firmware *FirmwareUpdateData `json:"firmware"`
	WAN      *WANStatusData      `json:"wan"`
	Health   *SystemHealthData   `json:"health"`
	Warnings []string            `json:"warnings"`
}

type routerInfoFields struct {
	ModelNumber     string `json:"modelNumber"`
	SerialNumber    string `json:"serialNumber"`
	HardwareVersion string `json:"hardwareVersion"`
	FirmwareVersion string `json:"firmwareVersion"`
	FirmwareDate    string `json:"firmwareDate"`
	Manufacturer    string `json:"manufacturer"`
	MACAddress      string `json:"macAddress"`
}

type routerInfoOutput struct {
	routerInfoFields
	DeviceInfo *routerInfoFields `json:"deviceInfo"`
}

type firmwareUpdateStatusOutput struct {
	LastCheck       string `json:"lastSuccessfulCheckTime"`
	AvailableUpdate *struct {
		Version     string `json:"firmwareVersion"`
		Date        string `json:"firmwareDate"`
		Description string `json:"description"`
	} `json:"availableUpdate"`
	PendingOperation *struct {
		Operation string `json:"operation"`
		Progress  int    `json:"progressPercent"`
	} `json:"pendingOperation"`
}

type wanConnectionOutput struct {
	WANType             string `json:"wanType"`
	IPAddress           string `json:"ipAddress"`
	NetworkPrefixLength int    `json:"networkPrefixLength"`
	Gateway             string `json:"gateway"`
	MTU                 int    `json:"mtu"`
	DHCPLeaseMinutes    int    `json:"dhcpLeaseMinutes"`
	DNSServer1          string `json:"dnsServer1"`
	DNSServer2          string `json:"dnsServer2"`
	DNSServer3          string `json:"dnsServer3"`
}

type wanIPv6ConnectionOutput struct {
	WANType     string `json:"wanType"`
	NetworkInfo *struct {
		IPAddress string `json:"ipAddress"`
		Gateway   string `json:"gateway"`
	} `json:"networkInfo"`
}

type wanStatusOutput struct {
	MACAddress        string                   `json:"macAddress"`
	DetectedWANType   string                   `json:"detectedWANType"`
	WANStatus         string                   `json:"wanStatus"`
	WANIPv6Status     string                   `json:"wanIPv6Status"`
	WANConnection     *wanConnectionOutput     `json:"wanConnection"`
	WANIPv6Connection *wanIPv6ConnectionOutput `json:"wanIPv6Connection"`
}

func parseRouterInfoOutput(raw json.RawMessage) (*RouterInfoData, error) {
	var output routerInfoOutput
	if err := json.Unmarshal(raw, &output); err != nil {
		return nil, fmt.Errorf("failed to parse router information: %w", err)
	}

	info := &RouterInfoData{
		ModelNumber:     output.ModelNumber,
		SerialNumber:    output.SerialNumber,
		HardwareVersion: output.HardwareVersion,
		FirmwareVersion: output.FirmwareVersion,
		FirmwareDate:    output.FirmwareDate,
		Manufacturer:    output.Manufacturer,
		MACAddress:      output.MACAddress,
	}

	if info.ModelNumber == "" && output.DeviceInfo != nil {
		info.ModelNumber = output.DeviceInfo.ModelNumber
		info.SerialNumber = output.DeviceInfo.SerialNumber
		info.HardwareVersion = output.DeviceInfo.HardwareVersion
		info.FirmwareVersion = output.DeviceInfo.FirmwareVersion
		info.FirmwareDate = output.DeviceInfo.FirmwareDate
		info.Manufacturer = output.DeviceInfo.Manufacturer
		info.MACAddress = output.DeviceInfo.MACAddress
	}

	if info.Manufacturer == "" {
		info.Manufacturer = "Linksys"
	}
	if info.ModelNumber == "" && info.SerialNumber == "" {
		return nil, fmt.Errorf("router returned empty device information")
	}
	return info, nil
}

func parseFirmwareUpdateOutput(raw json.RawMessage) (*FirmwareUpdateData, error) {
	var output firmwareUpdateStatusOutput
	if err := json.Unmarshal(raw, &output); err != nil {
		return nil, fmt.Errorf("failed to parse firmware update status: %w", err)
	}

	data := &FirmwareUpdateData{LastCheck: output.LastCheck}
	if output.AvailableUpdate != nil {
		data.UpdateAvailable = true
		data.NewVersion = output.AvailableUpdate.Version
		data.NewDate = output.AvailableUpdate.Date
		data.Description = output.AvailableUpdate.Description
	}
	if output.PendingOperation != nil {
		data.PendingOperation = output.PendingOperation.Operation
		data.ProgressPercent = output.PendingOperation.Progress
	}
	return data, nil
}

func isNonZeroAddress(ip string) bool {
	ip = strings.TrimSpace(ip)
	return ip != "" && ip != "0.0.0.0" && ip != "::" && ip != "0.0.0.0/0"
}

func parseWANStatusOutput(raw json.RawMessage) (*WANStatusData, error) {
	var output wanStatusOutput
	if err := json.Unmarshal(raw, &output); err != nil {
		return nil, fmt.Errorf("failed to parse WAN status: %w", err)
	}

	status := output.WANStatus
	isConnected := strings.EqualFold(status, "connected") || strings.EqualFold(status, "up") || strings.EqualFold(status, "online")

	data := &WANStatusData{
		Status:      status,
		IsConnected: isConnected,
		WANType:     output.DetectedWANType,
		MACAddress:  output.MACAddress,
		IPv6Status:  output.WANIPv6Status,
	}

	if output.WANConnection != nil {
		connection := output.WANConnection
		if connection.WANType != "" {
			data.WANType = connection.WANType
		}
		if isNonZeroAddress(connection.IPAddress) {
			data.IPAddress = strings.TrimSpace(connection.IPAddress)
		}
		data.NetworkPrefixLength = connection.NetworkPrefixLength
		if isNonZeroAddress(connection.Gateway) {
			data.Gateway = strings.TrimSpace(connection.Gateway)
		}
		data.MTU = connection.MTU
		data.DHCPLeaseMinutes = connection.DHCPLeaseMinutes
		data.DNS1 = connection.DNSServer1
		data.DNS2 = connection.DNSServer2
		data.DNS3 = connection.DNSServer3

		// If status string was absent or non-standard, infer connected if a valid IP was assigned
		if !data.IsConnected && data.IPAddress != "" {
			data.IsConnected = true
			if data.Status == "" {
				data.Status = "Connected"
			}
		}

		for _, server := range []string{connection.DNSServer1, connection.DNSServer2, connection.DNSServer3} {
			if isNonZeroAddress(server) {
				data.DNSServers = append(data.DNSServers, strings.TrimSpace(server))
			}
		}
	}

	if output.WANIPv6Connection != nil {
		if output.WANIPv6Connection.WANType != "" && data.WANType == "" {
			data.WANType = output.WANIPv6Connection.WANType
		}
		if output.WANIPv6Connection.NetworkInfo != nil {
			if isNonZeroAddress(output.WANIPv6Connection.NetworkInfo.IPAddress) {
				data.IPv6Address = strings.TrimSpace(output.WANIPv6Connection.NetworkInfo.IPAddress)
			}
			if isNonZeroAddress(output.WANIPv6Connection.NetworkInfo.Gateway) {
				data.IPv6Gateway = strings.TrimSpace(output.WANIPv6Connection.NetworkInfo.Gateway)
			}
		}
	}

	if data.Status == "" && data.IPAddress == "" && data.IPv6Address == "" {
		return nil, fmt.Errorf("router returned empty WAN status")
	}
	return data, nil
}

func numberValue(value interface{}) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case float32:
		return float64(number), true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	case json.Number:
		parsed, err := number.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(number, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func firstNumber(fields map[string]interface{}, keys ...string) (float64, bool) {
	for _, key := range keys {
		if value, ok := numberValue(fields[key]); ok {
			return value, true
		}
	}
	return 0, false
}

func healthFromFields(fields map[string]interface{}) *SystemHealthData {
	data := &SystemHealthData{}
	found := false

	if value, ok := firstNumber(fields, "uptimeSeconds", "uptime", "UpTime", "systemUptime"); ok {
		data.UptimeSeconds = int64(value)
		found = true
	}
	if value, ok := firstNumber(fields, "CPULoad", "cpuLoad", "cpuPercent", "cpuUtilization", "CPU"); ok {
		cpu := value
		data.CPULoadPercent = &cpu
		found = true
	}
	if value, ok := firstNumber(fields, "MemoryLoad", "memoryLoad", "memoryPercent", "memoryUtilization", "Memory"); ok {
		memory := value
		data.MemoryLoadPercent = &memory
		found = true
	} else {
		// If precomputed memory percentage is missing, compute from total/free or total/used
		total, hasTotal := firstNumber(fields, "totalMemory", "TotalMemory", "memTotal", "totalMem", "ramTotal")
		free, hasFree := firstNumber(fields, "freeMemory", "FreeMemory", "memFree", "freeMem", "ramFree")
		used, hasUsed := firstNumber(fields, "usedMemory", "UsedMemory", "memUsed", "usedMem", "ramUsed")
		if hasTotal && total > 0 {
			if hasUsed {
				memPct := (used / total) * 100
				data.MemoryLoadPercent = &memPct
				found = true
			} else if hasFree && total >= free {
				memPct := ((total - free) / total) * 100
				data.MemoryLoadPercent = &memPct
				found = true
			}
		}
	}
	if !found {
		return nil
	}
	return data
}

func parseSystemStatsOutput(raw json.RawMessage) (*SystemHealthData, error) {
	var output map[string]interface{}
	if err := json.Unmarshal(raw, &output); err != nil {
		return nil, fmt.Errorf("failed to parse system statistics: %w", err)
	}

	if data := healthFromFields(output); data != nil {
		return data, nil
	}

	// On some router models/firmwares, stats are wrapped inside a nested dictionary map
	for _, key := range []string{"systemStats", "stats", "diagnostics", "health"} {
		if sub, ok := output[key].(map[string]interface{}); ok {
			if data := healthFromFields(sub); data != nil {
				return data, nil
			}
		}
	}

	// Mesh firmware reports one row per node instead of flat values. Use the
	// first row that carries statistics; the overview only shows the router.
	for _, key := range []string{"deviceStats", "nodes", "stats"} {
		rows, ok := output[key].([]interface{})
		if !ok {
			continue
		}
		for _, row := range rows {
			fields, ok := row.(map[string]interface{})
			if !ok {
				continue
			}
			if data := healthFromFields(fields); data != nil {
				return data, nil
			}
		}
	}

	return nil, fmt.Errorf("router did not return system statistics")
}

func (s *LinksysService) requestWANStatus(client *linksys.Client) (*WANStatusData, string) {
	var lastError string
	for _, action := range []string{"router/GetWANStatus3", "router/GetWANStatus2", "router/GetWANStatus"} {
		var raw json.RawMessage
		if err := client.MakeRequest(action, nil, &raw); err != nil {
			lastError = err.Error()
			continue
		}
		data, err := parseWANStatusOutput(raw)
		if err != nil {
			lastError = err.Error()
			continue
		}
		return data, ""
	}

	if lastError == "" {
		lastError = "the router did not return WAN status"
	}
	return nil, lastError
}

func (s *LinksysService) requestSystemHealth(client *linksys.Client) (*SystemHealthData, string) {
	var lastError string
	for _, action := range []string{"diagnostics/GetSystemStats2", "diagnostics/GetSystemStats"} {
		var raw json.RawMessage
		if err := client.MakeRequest(action, nil, &raw); err != nil {
			lastError = err.Error()
			continue
		}
		data, err := parseSystemStatsOutput(raw)
		if err != nil {
			lastError = err.Error()
			continue
		}
		return data, ""
	}

	if lastError == "" {
		lastError = "the router did not return system statistics"
	}
	return nil, lastError
}

func (s *LinksysService) requestRouterInfo(client *linksys.Client) (*RouterInfoData, string) {
	var raw json.RawMessage
	if err := client.MakeRequest("core/GetDeviceInfo", nil, &raw); err != nil {
		return nil, err.Error()
	}
	info, err := parseRouterInfoOutput(raw)
	if err != nil {
		return nil, err.Error()
	}
	return info, ""
}

func (s *LinksysService) requestFirmwareUpdate(client *linksys.Client) (*FirmwareUpdateData, string) {
	var raw json.RawMessage
	if err := client.MakeRequest("firmwareupdate/GetFirmwareUpdateStatus", nil, &raw); err != nil {
		return nil, err.Error()
	}
	firmware, err := parseFirmwareUpdateOutput(raw)
	if err != nil {
		return nil, err.Error()
	}
	return firmware, ""
}

// GetWANStatus returns the router's current internet connection details.
func (s *LinksysService) GetWANStatus() (*WANStatusData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	data, warning := s.requestWANStatus(client)
	if data == nil {
		return nil, fmt.Errorf("failed to read WAN status: %s", warning)
	}
	return data, nil
}

// GetSystemHealth returns router uptime and resource usage when available.
func (s *LinksysService) GetSystemHealth() (*SystemHealthData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	data, warning := s.requestSystemHealth(client)
	if data == nil {
		return nil, fmt.Errorf("failed to read system health: %s", warning)
	}
	return data, nil
}

// GetRouterOverview fetches all overview data in one core/Transaction request.
// If the router refuses or does not support transactions, it falls back to
// individual requests and only fails when basic router information is missing.
func (s *LinksysService) GetRouterOverview() (*RouterOverviewData, error) {
	client, err := s.requireClient()
	if err != nil {
		return nil, err
	}

	responses := s.makeBatchRequest(client, []jnapBatchAction{
		{Name: "info", Action: "core/GetDeviceInfo"},
		{Name: "firmware", Action: "firmwareupdate/GetFirmwareUpdateStatus"},
		{Name: "wan", Action: "router/GetWANStatus3"},
		{Name: "health", Action: "diagnostics/GetSystemStats2"},
	})

	overview := &RouterOverviewData{Warnings: []string{}}

	if child, ok := responses["info"]; ok && child.succeeded() && len(child.Output) > 0 {
		info, parseErr := parseRouterInfoOutput(child.Output)
		if parseErr == nil {
			overview.Info = info
		} else {
			overview.Warnings = append(overview.Warnings, parseErr.Error())
		}
	}
	if overview.Info == nil {
		// Some firmware aborts one child of a transaction even though the same
		// action succeeds on its own, so retry the essential call directly.
		info, warning := s.requestRouterInfo(client)
		if info == nil {
			return nil, fmt.Errorf("failed to read router information: %s", warning)
		}
		overview.Info = info
	}

	if child, ok := responses["firmware"]; ok && child.succeeded() && len(child.Output) > 0 {
		firmware, parseErr := parseFirmwareUpdateOutput(child.Output)
		if parseErr == nil {
			overview.Firmware = firmware
		} else {
			overview.Warnings = append(overview.Warnings, parseErr.Error())
		}
	}
	if overview.Firmware == nil {
		firmware, warning := s.requestFirmwareUpdate(client)
		if firmware != nil {
			overview.Firmware = firmware
		} else {
			overview.Warnings = append(overview.Warnings, "Firmware update status is unavailable: "+warning)
		}
	}

	if child, ok := responses["wan"]; ok && child.succeeded() && len(child.Output) > 0 {
		wan, parseErr := parseWANStatusOutput(child.Output)
		if parseErr == nil {
			overview.WAN = wan
		}
	}
	if overview.WAN == nil {
		wan, warning := s.requestWANStatus(client)
		if wan != nil {
			overview.WAN = wan
		} else {
			overview.Warnings = append(overview.Warnings, "WAN status is unavailable: "+warning)
		}
	}

	if child, ok := responses["health"]; ok && child.succeeded() && len(child.Output) > 0 {
		health, parseErr := parseSystemStatsOutput(child.Output)
		if parseErr == nil {
			overview.Health = health
		}
	}
	if overview.Health == nil {
		health, warning := s.requestSystemHealth(client)
		if health != nil {
			overview.Health = health
		} else {
			overview.Warnings = append(overview.Warnings, "System health is unavailable: "+warning)
		}
	}

	return overview, nil
}
