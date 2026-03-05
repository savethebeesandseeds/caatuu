//! WebSocket upgrade + message loop. Each client message is parsed as JSON and
//! forwarded to core logic. We reply with a single JSON message per request.

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use std::sync::Arc;
use tracing::{debug, error, info, instrument};

use crate::logic::*;
use crate::protocol::to_out;
use crate::protocol::{ClientWsMessage, ServerWsMessage};
use crate::state::AppState;

#[instrument(level = "info", skip(state))]
pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    info!(target: "caatuu_backend", "WebSocket upgrade requested");
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

#[instrument(level = "info", skip(socket, state))]
async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    info!(target: "caatuu_backend", "WebSocket connected");
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(txt) => {
                // Parse, dispatch, serialize response.
                let reply_msg = match serde_json::from_str::<ClientWsMessage>(&txt) {
                    Ok(incoming) => {
                        let summary = ws_message_summary(&incoming);
                        debug!(target = "caatuu_backend", %summary, "WS received");
                        handle_client_ws(incoming, &state).await
                    }
                    Err(e) => ServerWsMessage::Error {
                        message: format!("Invalid JSON: {}", e),
                    },
                };

                let out = serde_json::to_string(&reply_msg).unwrap_or_else(|e| {
          serde_json::json!({ "type": "error", "message": format!("Serialization error: {}", e) }).to_string()
        });

                if let Err(e) = socket.send(Message::Text(out)).await {
                    error!(target: "caatuu_backend", error = %e, "WS send error");
                    break;
                }
            }
            Message::Ping(payload) => {
                let _ = socket.send(Message::Pong(payload)).await;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    info!(target: "caatuu_backend", "WebSocket disconnected");
}

fn ws_message_summary(msg: &ClientWsMessage) -> String {
    match msg {
        ClientWsMessage::Ping => "ping".into(),
        ClientWsMessage::NewChallenge {
            difficulty,
            context_zh,
            mode,
        } => {
            let mode_label = if mode.trim().is_empty() {
                "default".to_string()
            } else {
                mode.trim().to_string()
            };
            format!(
                "new_challenge difficulty={difficulty} mode={mode_label} context_len={}",
                context_zh.len()
            )
        }
        ClientWsMessage::SubmitAnswer {
            challenge_id,
            answer,
        } => {
            format!(
                "submit_answer challenge_id={challenge_id} answer_len={}",
                answer.len()
            )
        }
        ClientWsMessage::Hint {
            challenge_id,
            fast_only,
        } => {
            format!("hint challenge_id={challenge_id} fast_only={fast_only}")
        }
        ClientWsMessage::TranslateInput { text, fast_only } => {
            format!(
                "translate_input text_len={} fast_only={}",
                text.len(),
                fast_only
            )
        }
        ClientWsMessage::PinyinInput { text } => format!("pinyin_input text_len={}", text.len()),
        ClientWsMessage::GrammarInput { text, fast_only } => {
            format!(
                "grammar_input text_len={} fast_only={}",
                text.len(),
                fast_only
            )
        }
        ClientWsMessage::SpeechToTextInput { audio_base64, mime } => {
            format!(
                "speech_to_text_input mime={mime} base64_len={}",
                audio_base64.len()
            )
        }
        ClientWsMessage::NextChar {
            challenge_id,
            current,
        } => {
            format!(
                "next_char challenge_id={challenge_id} current_len={}",
                current.len()
            )
        }
        ClientWsMessage::AgentMessage {
            challenge_id,
            text,
            fast_only,
        } => {
            format!(
                "agent_message challenge_id={challenge_id} text_len={} fast_only={}",
                text.len(),
                fast_only
            )
        }
        ClientWsMessage::AgentReset => "agent_reset".into(),
        ClientWsMessage::SaveSettings { .. } => "save_settings".into(),
    }
}

#[instrument(level = "info", skip(state))]
async fn handle_client_ws(msg: ClientWsMessage, state: &AppState) -> ServerWsMessage {
    match msg {
        ClientWsMessage::Ping => ServerWsMessage::Pong,

        ClientWsMessage::NewChallenge {
            difficulty,
            context_zh,
            mode,
        } => {
            let mode_norm = mode.trim();
            let (ch, origin) = if mode_norm == "writing_guide" {
                state.choose_writing_guide(&difficulty, &context_zh).await
            } else {
                state.choose_challenge(&difficulty).await
            };
            tracing::info!(target: "challenge", %difficulty, id = %ch.id, %origin, mode = %if mode_norm.is_empty() { "default" } else { mode_norm }, "WS new_challenge served");
            ServerWsMessage::Challenge {
                challenge: to_out(&ch),
            }
        }

        ClientWsMessage::SubmitAnswer {
            challenge_id,
            answer,
        } => {
            let (correct, score, expected, explanation) =
                evaluate_answer(state, &challenge_id, &answer).await;
            tracing::info!(target: "challenge", id = %challenge_id, %correct, score = %format!("{:.1}", score), "WS submit_answer evaluated");
            ServerWsMessage::AnswerResult {
                correct,
                score,
                expected,
                explanation,
            }
        }

        ClientWsMessage::Hint {
            challenge_id,
            fast_only,
        } => {
            let text = get_hint_text_with_mode(state, &challenge_id, fast_only).await;
            tracing::info!(target: "challenge", id = %challenge_id, "WS hint served");
            ServerWsMessage::Hint { text }
        }

        ClientWsMessage::TranslateInput { text, fast_only } => {
            let translation = do_translate_with_mode(state, &text, fast_only).await;
            ServerWsMessage::Translate { text, translation }
        }

        ClientWsMessage::PinyinInput { text } => {
            let pinyin = do_pinyin(state, &text).await;
            ServerWsMessage::Pinyin { text, pinyin }
        }

        ClientWsMessage::GrammarInput { text, fast_only } => {
            let corrected = do_grammar_with_mode(state, &text, fast_only).await;
            ServerWsMessage::Grammar { text, corrected }
        }

        ClientWsMessage::SpeechToTextInput { audio_base64, mime } => {
            match do_speech_to_text(state, &audio_base64, &mime).await {
                Ok(text) => ServerWsMessage::SpeechToText { text },
                Err(message) => ServerWsMessage::SpeechToTextError { message },
            }
        }

        ClientWsMessage::NextChar {
            challenge_id,
            current,
        } => {
            let (c, p, reason) = next_char_logic(state, &challenge_id, &current).await;
            ServerWsMessage::NextChar {
                char: c,
                pinyin: p,
                reason,
            }
        }

        ClientWsMessage::AgentMessage {
            challenge_id,
            text,
            fast_only,
        } => {
            let reply = do_agent_reply_with_mode(state, &challenge_id, &text, fast_only).await;
            ServerWsMessage::AgentReply { text: reply }
        }

        ClientWsMessage::AgentReset => {
            tracing::info!(target: "caatuu_backend", "WS agent_reset noop acknowledged");
            ServerWsMessage::Pong
        }

        ClientWsMessage::SaveSettings { .. } => ServerWsMessage::Error {
            message: "Server-side settings persistence not implemented in this demo.".into(),
        },
    }
}
