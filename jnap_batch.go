package main

import (
	"encoding/json"
	"strings"

	"github.com/reujab/linksys"
)

const jnapActionPrefix = "http://linksys.com/jnap/"

// jnapBatchAction describes one action inside a core/Transaction request.
type jnapBatchAction struct {
	Name    string
	Action  string
	Request interface{}
}

type jnapBatchRequest struct {
	Action  string      `json:"action"`
	Request interface{} `json:"request"`
}

// jnapChildResponse is the response for one action inside core/Transaction.
type jnapChildResponse struct {
	Result   string          `json:"result"`
	Response string          `json:"response"`
	Output   json.RawMessage `json:"output"`
	Error    string          `json:"error"`
}

func (r jnapChildResponse) succeeded() bool {
	status := r.Result
	if status == "" {
		status = r.Response
	}
	return strings.EqualFold(status, "OK")
}

type jnapTransactionOutput struct {
	Responses []jnapChildResponse `json:"responses"`
}

// makeBatchRequest sends several JNAP actions in a single core/Transaction
// request. Some firmware refuses transactions even when the password is valid,
// and older firmware may not implement core/Transaction at all, so any failure
// falls back to one request per action. The fallback keeps the rest of the app
// working without special-casing models.
func (s *LinksysService) makeBatchRequest(client *linksys.Client, actions []jnapBatchAction) map[string]jnapChildResponse {
	if len(actions) == 0 {
		return map[string]jnapChildResponse{}
	}

	requests := make([]jnapBatchRequest, 0, len(actions))
	for _, action := range actions {
		request := action.Request
		if request == nil {
			request = struct{}{}
		}
		requests = append(requests, jnapBatchRequest{
			Action:  jnapActionPrefix + action.Action,
			Request: request,
		})
	}

	var output jnapTransactionOutput
	err := client.MakeRequest("core/Transaction", requests, &output)
	if err == nil && len(output.Responses) == len(actions) {
		results := make(map[string]jnapChildResponse, len(actions))
		for index, action := range actions {
			results[action.Name] = output.Responses[index]
		}
		return results
	}

	return s.makeSequentialRequests(client, actions)
}

func (s *LinksysService) makeSequentialRequests(client *linksys.Client, actions []jnapBatchAction) map[string]jnapChildResponse {
	results := make(map[string]jnapChildResponse, len(actions))
	for _, action := range actions {
		request := action.Request
		if request == nil {
			request = struct{}{}
		}

		var raw json.RawMessage
		if err := client.MakeRequest(action.Action, request, &raw); err != nil {
			results[action.Name] = jnapChildResponse{
				Result: "Error",
				Error:  err.Error(),
			}
			continue
		}
		results[action.Name] = jnapChildResponse{
			Result: "OK",
			Output: raw,
		}
	}
	return results
}
