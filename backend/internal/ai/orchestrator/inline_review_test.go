package orchestrator

import "testing"

func TestParseInlineHumanReviewOutputStripsInternalBlock(t *testing.T) {
	raw := `<customer_reply>
Sure, our sweets include gulab jamun and kaju katli [1].
</customer_reply>
<human_review_json>
{"requires_review":true,"severity":"high","priority_score":88,"reason_code":"price_question","reason_label":"Price question","reason_detail":"Buyer asked about pricing.","suggested_action":"Review pricing before the next reply.","labels":["warm_lead"],"summary":"Buyer is asking about price.","next_action":"Confirm price list."}
</human_review_json>`

	reply, signal := parseInlineHumanReviewOutput(raw)
	if reply != "Sure, our sweets include gulab jamun and kaju katli [1]." {
		t.Fatalf("reply leaked or changed: %q", reply)
	}
	if signal == nil {
		t.Fatal("signal nil")
	}
	if !signal.RequiresReview || signal.ReasonCode != "price_question" || signal.Severity != "high" {
		t.Fatalf("unexpected signal: %+v", signal)
	}
}

func TestParseInlineHumanReviewOutputJSONEnvelope(t *testing.T) {
	raw := `{"reply":"I can help with that.","review":{"requires_review":false,"severity":"low","priority_score":0,"reason_code":"none","labels":["ai_handled"],"summary":"Answered safely."}}`

	reply, signal := parseInlineHumanReviewOutput(raw)
	if reply != "I can help with that." {
		t.Fatalf("reply = %q", reply)
	}
	if signal == nil {
		t.Fatal("signal nil")
	}
	if signal.RequiresReview {
		t.Fatalf("requires_review = true, want false")
	}
}
