//! Public protocol structs for WebSocket and HTTP endpoints (serde ready).
//! Keep this small and stable to evolve backend and frontend independently.

use serde::{Deserialize, Serialize};

use crate::domain::{Challenge, ChallengeKind, ChallengeSource};

/// Messages the client can send over WebSocket.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientWsMessage {
    Ping,
    NewChallenge {
        difficulty: String,
    },
    SubmitAnswer {
        #[serde(rename = "challengeId")]
        challenge_id: String,
        answer: String,
    },
    Hint {
        #[serde(rename = "challengeId")]
        challenge_id: String,
    },
    TranslateInput {
        text: String,
    },
    PinyinInput {
        text: String,
    },
    GrammarInput {
        text: String,
    }, // NEW
    SpeechToTextInput {
        #[serde(rename = "audioBase64")]
        audio_base64: String,
        mime: String,
    },
    NextChar {
        #[serde(rename = "challengeId")]
        challenge_id: String,
        current: String,
    },
    AgentMessage {
        #[serde(rename = "challengeId")]
        challenge_id: String,
        text: String,
    },
    AgentReset,
    SaveSettings {/* arbitrary blob */},
}

/// Messages the server sends back over WebSocket.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerWsMessage {
    Pong,
    Challenge {
        challenge: ChallengeOut,
    },
    AnswerResult {
        correct: bool,
        score: f32,
        expected: String,
        explanation: String,
    }, // score added
    Hint {
        text: String,
    },
    Translate {
        text: String,
        translation: String,
    },
    Pinyin {
        text: String,
        pinyin: String,
    },
    Grammar {
        text: String,
        corrected: String,
    }, // NEW
    SpeechToText {
        text: String,
    },
    SpeechToTextError {
        message: String,
    },
    NextChar {
        char: String,
        pinyin: String,
        reason: String,
    },
    AgentReply {
        text: String,
    },
    Error {
        message: String,
    },
}

/// DTO used by both WS and HTTP for challenge delivery.
#[derive(Debug, Serialize)]
pub struct ChallengeOut {
    pub id: String,
    pub difficulty: String,
    pub kind: ChallengeKind,
    pub source: ChallengeSource,

    pub seed_zh: String,
    pub seed_en: String,
    pub challenge_zh: String,
    pub challenge_en: String,
    pub summary_en: String,

    pub instructions: String,
}

/// Convert full `Challenge` (internal) to the public DTO.
pub fn to_out(c: &Challenge) -> ChallengeOut {
    ChallengeOut {
        id: c.id.clone(),
        difficulty: c.difficulty.clone(),
        kind: c.kind.clone(),
        source: c.source.clone(),

        seed_zh: c.seed_zh.clone(),
        seed_en: c.seed_en.clone(),
        challenge_zh: c.challenge_zh.clone(),
        challenge_en: c.challenge_en.clone(),
        summary_en: c.summary_en.clone(),

        instructions: c.instructions.clone(),
    }
}

//
// HTTP request/response DTOs
//

#[derive(Debug, Deserialize)]
pub struct ChallengeQuery {
    pub difficulty: Option<String>,
}

#[derive(Deserialize)]
pub struct AnswerIn {
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
    pub answer: String,
}
#[derive(Serialize)]
pub struct AnswerOut {
    pub correct: bool,
    pub score: f32, // NEW
    pub expected: String,
    pub explanation: String,
}

#[derive(Debug, Deserialize)]
pub struct HintQuery {
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
}
#[derive(Serialize)]
pub struct HintOut {
    pub text: String,
}

#[derive(Deserialize)]
pub struct TranslateIn {
    pub text: String,
}
#[derive(Serialize)]
pub struct TranslateOut {
    pub translation: String,
}

#[derive(Deserialize)]
pub struct PinyinIn {
    pub text: String,
}
#[derive(Serialize)]
pub struct PinyinOut {
    pub pinyin: String,
}

// NEW: Grammar correction
#[derive(Deserialize)]
pub struct GrammarIn {
    pub text: String,
}
#[derive(Serialize)]
pub struct GrammarOut {
    pub corrected: String,
}

#[derive(Deserialize)]
pub struct NextCharIn {
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
    pub current: String,
}
#[derive(Serialize)]
pub struct NextCharOut {
    pub char: String,
    pub pinyin: String,
    pub reason: String,
}

#[derive(Deserialize)]
pub struct AgentIn {
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
    pub text: String,
}
#[derive(Serialize)]
pub struct AgentOut {
    pub text: String,
}

#[derive(Serialize)]
pub struct HealthOut {
    pub ok: bool,
}
