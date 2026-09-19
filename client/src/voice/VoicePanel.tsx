import { VOICE_MAX_PARTICIPANTS } from 'shared';
import { usePresenceStore } from '../canvas/presence-store';
import { colorForUser, initialsOf } from '../canvas/presence-colors';
import { setDeafened, setMicMuted, startVoice, stopVoice, voiceIsFull } from './voice-mesh';
import {
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
} from '../canvas/icons';
import type { PeerInfo } from './voice-store';
import { useVoiceStore } from './voice-store';

function describe(peer: PeerInfo) {
  if (peer.phase === 'failed') return 'звʼязок не вдався';
  if (peer.phase !== 'live') return 'підключається';
  if (peer.volume === 0) return 'надто далеко, не чути';
  return `чути на ${Math.round(peer.volume * 100)}%`;
}

// вхід у розмову й хто в ній зараз. Кружечки ті самі, що в списку присутніх,
// тим самим кольором — щоб голос і полотно читались як одна людина
export function VoicePanel() {
  const inVoice = useVoiceStore((s) => s.inVoice);
  const starting = useVoiceStore((s) => s.starting);
  const peers = useVoiceStore((s) => s.peers);
  const error = useVoiceStore((s) => s.error);
  const micMuted = useVoiceStore((s) => s.micMuted);
  const deafened = useVoiceStore((s) => s.deafened);
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

      {inVoice && (
        <div className="voice-self">
          <button
            type="button"
            className={micMuted ? 'voice-toggle off' : 'voice-toggle'}
            title={micMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
            aria-label={micMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
            aria-pressed={micMuted}
            onClick={() => setMicMuted(!micMuted)}
          >
            {micMuted ? <MicOffIcon /> : <MicIcon />}
          </button>
          <button
            type="button"
            className={deafened ? 'voice-toggle off' : 'voice-toggle'}
            title={deafened ? 'Увімкнути звук' : 'Вимкнути звук усіх'}
            aria-label={deafened ? 'Увімкнути звук' : 'Вимкнути звук усіх'}
            aria-pressed={deafened}
            onClick={() => setDeafened(!deafened)}
          >
            {deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
          </button>
        </div>
      )}

      {peerIds.length > 0 && (
        <div className="voice-peers">
          {peerIds.map((clientId) => {
            const member = members[clientId];
            if (!member) return null;
            return (
              <span
                key={clientId}
                className={`voice-peer ${peers[clientId].phase}`}
                style={{
                  background: colorForUser(member.userId),
                  // видно, кого зараз чути: далекий стілець — блідий кружечок
                  opacity: peers[clientId].phase === 'live' ? 0.25 + peers[clientId].volume * 0.75 : undefined,
                }}
                data-volume={Math.round(peers[clientId].volume * 100)}
                title={`${member.displayName} — ${describe(peers[clientId])}`}
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
