## 1. Normal: GET /v1/health/ready?probe=ai  (port 8787, AI enabled)
HTTP/1.1 200 OK
x-correlation-id: 7cdd1589-f946-44fd-9489-7324ad280a8d
{
    "status": "ok",
    "service": "learning-assistant",
    "answerPath": "ai_with_fallback",
    "checks": {
        "database": {
            "status": "pass",
            "latencyMs": 14,
            "detail": {
                "tables": 6
            }
        },
        "ai": {
            "status": "pass",
            "latencyMs": 238,
            "detail": {
                "model": "@cf/meta/llama-3.2-3b-instruct",
                "probe": "pass"
            }
        },
        "ai_budget": {
            "status": "pass",
            "latencyMs": 22,
            "detail": {
                "invocationsToday": 297,
                "dailyBudgetPerCourse": 1000
            }
        }
    },
    "timestamp": "2026-11-07T21:53:06.146Z"
}

## 2. AI unavailable: GET /v1/health/ready  (port 8788, AI_ENABLED=false)
HTTP/1.1 503 Service Unavailable
{
    "status": "degraded",
    "service": "learning-assistant",
    "answerPath": "keyword_fallback_only",
    "checks": {
        "database": {
            "status": "pass",
            "latencyMs": 14,
            "detail": {
                "tables": 6
            }
        },
        "ai": {
            "status": "fail",
            "latencyMs": 0,
            "error": "AI_ENABLED is not \"true\" (fallback only)"
        },
        "ai_budget": {
            "status": "pass",
            "latencyMs": 8,
            "detail": {
                "invocationsToday": 297,
                "dailyBudgetPerCourse": 1000
            }
        }
    },
    "timestamp": "2026-11-07T21:53:06.218Z"
}

## 3. AI unavailable: POST /v1/questions still answers (keyword fallback)
HTTP/1.1 201 Created
x-correlation-id: demo-ai-down-0001

{
  "status": "answered",
  "generation": {
    "mode": "fallback",
    "fallbackReason": "disabled",
    "model": null
  },
  "note": "This is a deterministic keyword search over approved course materials, not an AI-generated explanation.",
  "citations": 3
}

## 4. Liveness /v1/health is unchanged
{"status":"ok","service":"learning-assistant"}
