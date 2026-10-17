// The course shell owns voices, locale, pace, and the actual speech backend.
export function createMoonSpeech({ api, onState = () => {} } = {}) {
  let current = { status: 'idle', text: '', error: null, lastOutcome: null };
  let request = 0;
  let destroyed = false;
  const state = () => ({ ...current });
  const active = id => !destroyed && id === request;
  const update = next => {
    current = next;
    if (!destroyed) onState(state());
  };
  const idle = lastOutcome => ({ status: 'idle', text: '', error: null, lastOutcome });
  const message = error => String(error?.message || error || 'Audio playback is unavailable.');

  async function stop() {
    if (destroyed) return state();
    request += 1;
    update(idle('stopped'));
    try { await api?.stopSpeech?.(); } catch { /* Stopped UI must stay stopped. */ }
    return state();
  }

  async function play(text) {
    if (destroyed) return state();
    const normalized = String(text || '').normalize('NFC').trim();
    if (!normalized) return stop();
    if (current.text === normalized && ['loading', 'playing'].includes(current.status)) return stop();
    const id = ++request;
    update({ status: 'loading', text: normalized, error: null, lastOutcome: null });
    try {
      if (typeof api?.speakText !== 'function' || typeof api?.stopSpeech !== 'function') {
        throw new Error('Audio playback is unavailable.');
      }
      await api.stopSpeech();
      if (!active(id)) return state();
      const result = await api.speakText(normalized, {
        allowWhileMuted: true,
        onStart() {
          if (active(id)) update({ status: 'playing', text: normalized, error: null, lastOutcome: null });
        }
      });
      if (!active(id)) return state();
      request += 1;
      const outcome = result?.outcome || 'completed';
      if (outcome === 'error') {
        update({ status: 'error', text: normalized,
          error: message(result?.error || result?.message), lastOutcome: 'error' });
      } else update(idle(outcome));
    } catch (error) {
      if (active(id)) {
        request += 1;
        update({ status: 'error', text: normalized, error: message(error), lastOutcome: 'error' });
      }
    }
    return state();
  }

  async function destroy() {
    if (destroyed) return;
    request += 1;
    destroyed = true;
    current = idle('stopped');
    try { await api?.stopSpeech?.(); } catch { /* There is no live view to notify. */ }
  }

  return { play, stop, destroy, state };
}
