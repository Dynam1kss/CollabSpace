import { VOICE_MAX_PARTICIPANTS } from 'shared';
import { usePresenceStore } from '../canvas/presence-store';
import { colorForUser, initialsOf } from '../canvas/presence-colors';
import { startVoice, stopVoice, voiceIsFull } from './voice-mesh';
import { useVoiceStore } from './voice-store';

// вхід у розмову й хто в ній зараз. Кружечки ті самі, що в списку присутніх,
// тим самим кольором — щоб голос і полотно читались як одна людина
export function VoicePanel() {
  const inVoice = useVoiceStore((s) => s.inVoice);
  const starting = useVoiceStore((s) => s.starting);
  const peers = useVoiceStore((s) => s.peers);
  const error = useVoiceStore((s) => s.error);
  const members = usePresenceStore((s) => s.members);

  const peerIds = Object.keys(peers).map(Number);
  const full = !inVoice && voiceIsFull();

  return (
    <div className="board-island voice-panel">
      <button
        type="button"
        className={inVoice ? 'voice-leave' : 'voice-join'}
        disabled={starting || full}
        onClick={() => (inVoice ? stopVoice() : void startVoice())}
      >
        {starting ? 'мікрофон…' : inVoice ? 'Вийти з розмови' : 'Приєднатись до розмови'}
      </button>

      {peerIds.length > 0 && (
        <div className="voice-peers">
          {peerIds.map((clientId) => {
            const member = members[clientId];
            if (!member) return null;
            return (
              <span
                key={clientId}
                className={`voice-peer ${peers[clientId]}`}
                style={{ background: colorForUser(member.userId) }}
                title={`${member.displayName} — ${peers[clientId] === 'live' ? 'у розмові' : peers[clientId] === 'failed' ? "звʼязок не вдався" : 'підключається'}`}
              >
                {initialsOf(member.displayName)}
              </span>
            );
          })}
        </div>
      )}

      {full && <span className="voice-note">розмова повна ({VOICE_MAX_PARTICIPANTS})</span>}
      {error && <span className="voice-note voice-error">{error}</span>}
    </div>
  );
}
