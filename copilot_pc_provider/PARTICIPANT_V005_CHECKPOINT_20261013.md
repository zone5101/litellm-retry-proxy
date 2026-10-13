# ChatGPT PC v0.0.5 - reference admission closure

- 17:50:55 Local Chat UI reached participant, then failed admission with 1 unknown reference (ID not recorded). v0.0.4 whitelist had not worked.
- v0.0.5 never inspects or transmits reference or history values. It warns on omissions; only typed text enters the 8192-byte backend. Slash commands and tools fail closed.
- VSIX v0.0.5 installed. 19/19 Node tests PASS.
- A host-shim calling the installed participant with unreadable proxy-trap reference and history reached live isolated ChatGPT PC via LiteLLM; response PC_OPAQUE_REF_V005_20261013 PASS.
- Evidence: isolated_renderer_bridge/evidence/participant-opaque-reference-v005-20261013.json.
- This is a live backend test, not an actual VS Code UI pass. Next fresh Local Chat request should record participant.enter -> participant.context_omitted -> participant.http -> participant.pass.
- Port 4000 and production ChatGPT untouched. Staging 19493 was stopped.
