//! WebSocket upgrade + message loop. Each client message is parsed as JSON and
//! forwarded to core logic. We reply with a single JSON message per request.

use std::sync::Arc;
use axum::{
  extract::{
    ws::{Message, WebSocket},
    State, WebSocketUpgrade,
  },
  response::IntoResponse,
};
use tracing::{info, error, instrument, debug};

use crate::protocol::{ClientWsMessage, ServerWsMessage};
use crate::protocol::to_out;
use crate::logic::*;
use crate::state::AppState;

#[instrument(level = "info", skip(state))]
pub async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
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
            debug!(target = "caatuu_backend", "WS received: {:?}", &incoming);
            handle_client_ws(incoming, &state).await
          }
          Err(e) => ServerWsMessage::Error { message: format!("Invalid JSON: {}", e) },
        };

        let out = serde_json::to_string(&reply_msg).unwrap_or_else(|e| {
          serde_json::json!({ "type": "error", "message": format!("Serialization error: {}", e) }).to_string()
        });

        if let Err(e) = socket.send(Message::Text(out)).await {
          error!(target: "caatuu_backend", error = %e, "WS send error");
          break;
        }
      }
      Message::Ping(payload) => { let _ = socket.send(Message::Pong(payload)).await; }
      Message::Close(_) => break,
      _ => {}
    }
  }
  info!(target: "caatuu_backend", "WebSocket disconnected");
}

#[instrument(level = "info", skip(state))]
async fn handle_client_ws(msg: ClientWsMessage, state: &AppState) -> ServerWsMessage {
  match msg {
    ClientWsMessage::NewChallenge { difficulty } => {
      let (ch, origin) = state.choose_challenge(&difficulty).await;
      tracing::info!(target: "challenge", %difficulty, id = %ch.id, %origin, "WS new_challenge served");
      ServerWsMessage::Challenge { challenge: to_out(&ch) }
    }

    ClientWsMessage::SubmitAnswer { challenge_id, answer } => {
      let (correct, expected, explanation) = evaluate_answer(state, &challenge_id, &answer).await;
      tracing::info!(target: "challenge", id = %challenge_id, %correct, "WS submit_answer evaluated");
      ServerWsMessage::AnswerResult { correct, expected, explanation }
    }

    ClientWsMessage::Hint { challenge_id } => {
      let text = get_hint_text(state, &challenge_id).await;
      tracing::info!(target: "challenge", id = %challenge_id, "WS hint served");
      ServerWsMessage::Hint { text }
    }

    ClientWsMessage::TranslateInput { text } => {
      let translation = do_translate(state, &text).await;
      ServerWsMessage::Translate { text, translation }
    }

    ClientWsMessage::PinyinInput { text } => {
      let pinyin = do_pinyin(state, &text).await;
      ServerWsMessage::Pinyin { text, pinyin }
    }

    ClientWsMessage::NextChar { challenge_id, current } => {
      let (c, p, reason) = next_char_logic(state, &challenge_id, &current).await;
      ServerWsMessage::NextChar { char: c, pinyin: p, reason }
    }

    ClientWsMessage::AgentMessage { challenge_id, text } => {
      let reply = do_agent_reply(state, &challenge_id, &text).await;
      ServerWsMessage::AgentReply { text: reply }
    }

    ClientWsMessage::SaveSettings { .. } =>
      ServerWsMessage::Error { message: "Server-side settings persistence not implemented in this demo.".into() },
  }
}
