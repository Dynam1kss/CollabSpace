import { useState } from 'react';
import { VOICE_MAX_PARTICIPANTS } from 'shared';
import { usePresenceStore } from '../canvas/presence-store';
import { colorForUser, initialsOf } from '../canvas/presence-colors';
import { forceVoice } from '../api/boards';
import { canManageMember } from 'shared';
import { setDeafened, setMicMuted, startVoice, stopVoice, voiceIsFull } from './voice-mesh';
import {
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
} from '../canvas/icons';
import type { PeerInfo } from './voice-store';
import { useVoiceStore } from './voice-store';
import { useNarrow } from '../use-narrow';

// вимкнув адміністратор — це НЕ те саме, що «я сам вимкнув і можу ввімкнути»:
// окремий клас домальовує замок і червоний тон, інакше кнопка виглядає просто
// застряглою
function selfClass(off: boolean, forced: boolean) {
  if (forced) return 'voice-toggle locked';
  return off ? 'voice-toggle off' : 'voice-toggle';
}

// те саме, що в title замка, але текстом: на тачі наведення нема, і підказку
// ніхто не побачить
function describeForced(f: { mute: boolean; deafen: boolean }) {
  if (f.mute && f.deafen) return 'адміністратор вимкнув мікрофон і звук';
  if (f.mute) return 'адміністратор вимкнув мікрофон';
  if (f.deafen) return 'адміністратор вимкнув звук';
  return null;
}

function describe(peer: PeerInfo) {
  if (peer.phase === 'failed') return 'звʼязок не вдався';
  if (peer.phase !== 'live') return 'підключається';
  if (peer.volume === 0) return 'надто далеко, не чути';
  return `чути на ${Math.round(peer.volume * 100)}%`;
}

// вхід у розмову й хто в ній зараз. Кружечки ті самі, що в списку присутніх,
// тим самим кольором — щоб голос і полотно читались як одна людина
interface Props {
  boardId: string;
  currentUserId: string;
  ownerId: string;
}

export function VoicePanel({ boardId, currentUserId, ownerId }: Props) {
  const inVoice = useVoiceStore((s) => s.inVoice);
  const starting = useVoiceStore((s) => s.starting);
  const peers = useVoiceStore((s) => s.peers);
  const error = useVoiceStore((s) => s.error);
  const micMuted = useVoiceStore((s) => s.micMuted);
  const deafened = useVoiceStore((s) => s.deafened);
  const members = usePresenceStore((s) => s.members);
  const selfRole = usePresenceStore((s) => s.selfRole);
  const forced = useVoiceStore((s) => s.forced);
  const speaking = useVoiceStore((s) => s.speaking);
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking);
  const selfClientId = usePresenceStore((s) => s.selfClientId);
  // мене самого вимкнули примусово — кнопки замкнені, поки не знімуть
  const myForced = forced[currentUserId] ?? { mute: false, deafen: false };

  const peerIds = Object.keys(peers).map(Number);
  const full = !inVoice && voiceIsFull();
  // на телефоні панель постійно висить згорнутою пігулкою (свої перемикачі +
  // лічильник), решту ховає css — розмітка та сама, щоб не двоїти кнопки
  const narrow = useNarrow();
  const [expanded, setExpanded] = useState(false);
  const myLock = describeForced(myForced);
  const mini = narrow && !expanded;

  return (
    <div className={`board-island voice-panel${narrow ? (mini ? ' voice-mini' : ' voice-sheet') : ''}`}>
      <button
        type="button"
        className={inVoice ? 'voice-leave' : 'voice-join'}
        disabled={starting || full}
        onClick={() => (inVoice ? stopVoice() : void startVoice())}
      >
        {starting ? 'мікрофон…' : inVoice ? 'Вийти з розмови' : 'Приєднатись до розмови'}
      </button>

      {/* примусово вимкнені кнопки лишаються клікабельними: на disabled браузер
      не показує title, а саме з нього людина й дізнається, що це адміністратор */}
      {inVoice && (
        <div className="voice-self">
          <button
            type="button"
            className={selfClass(micMuted, myForced.mute)}
            title={
              myForced.mute
                ? 'Мікрофон вимкнено адміністратором'
                : micMuted
                  ? 'Увімкнути мікрофон'
                  : 'Вимкнути мікрофон'
            }
            aria-label={myForced.mute ? 'Мікрофон вимкнено адміністратором' : micMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
            aria-pressed={micMuted}
            aria-disabled={myForced.mute}
            onClick={() => !myForced.mute && setMicMuted(!micMuted)}
          >
            {micMuted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
          </button>
          <button
            type="button"
            className={selfClass(deafened, myForced.deafen)}
            title={
              myForced.deafen
                ? 'Звук вимкнено адміністратором'
                : deafened
                  ? 'Знову чути всіх'
                  : 'Не чути нікого'
            }
            aria-label={myForced.deafen ? 'Звук вимкнено адміністратором' : deafened ? 'Знову чути всіх' : 'Не чути нікого'}
            aria-pressed={deafened}
            aria-disabled={myForced.deafen}
            onClick={() => !myForced.deafen && setDeafened(!deafened)}
          >
            {deafened ? <HeadphonesOffIcon size={22} /> : <HeadphonesIcon size={22} />}
          </button>
        </div>
      )}

      {inVoice && selfClientId !== null && members[selfClientId] && (
        <div className="voice-peers">
          <span
            className={selfSpeaking ? 'voice-chip self speaking' : 'voice-chip self'}
            title={`${members[selfClientId].displayName} (я)${selfSpeaking ? ' — говорить' : ''}`}
          >
            <span className="voice-peer" style={{ background: colorForUser(members[selfClientId].userId) }}>
              {initialsOf(members[selfClientId].displayName)}
            </span>
          </span>
        </div>
      )}

      {peerIds.length > 0 && (
        <div className="voice-peers">
          {peerIds.map((clientId) => {
            const member = members[clientId];
            if (!member) return null;
            const theirForced = forced[member.userId] ?? { mute: false, deafen: false };
            // керувати чужим мікрофоном може лише той, хто вищий за людину
            const canForce = selfRole ? canManageMember(selfRole, member, ownerId) : false;
            return (
              <span key={clientId} className="voice-peer-row">
                <span
                  className={speaking[clientId] ? 'voice-chip speaking' : 'voice-chip'}
                  title={`${member.displayName} — ${describe(peers[clientId])}${speaking[clientId] ? ', говорить' : ''}`}
                >
                  <span
                    className={`voice-peer ${peers[clientId].phase}`}
                    style={{
                      background: colorForUser(member.userId),
                      opacity:
                        peers[clientId].phase === 'live' ? 0.25 + peers[clientId].volume * 0.75 : undefined,
                    }}
                    data-volume={Math.round(peers[clientId].volume * 100)}
                  >
                    {initialsOf(member.displayName)}
                  </span>
                </span>
                {/* на тачі те, що на десктопі лежить у title кружечка, мусить
                бути текстом — наведення там нема */}
                {narrow && (
                  <span className="voice-peer-who">
                    <span className="voice-peer-name">{member.displayName}</span>
                    <span className="voice-note">{describe(peers[clientId])}</span>
                  </span>
                )}
                {(theirForced.mute || theirForced.deafen) && (
                  <span className="voice-locked" title={describeForced(theirForced) ?? undefined}>
                    🔒
                  </span>
                )}
                {canForce && (
                  <>
                    <button
                      type="button"
                      className={theirForced.mute ? 'voice-force on' : 'voice-force'}
                      title={theirForced.mute ? 'Повернути мікрофон' : 'Вимкнути мікрофон учаснику'}
                      aria-label={`Мікрофон: ${member.displayName}`}
                      onClick={() =>
                        void forceVoice(boardId, { userId: member.userId, mute: !theirForced.mute }).catch(
                          () => {},
                        )
                      }
                    >
                      {theirForced.mute ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
                    </button>
                    <button
                      type="button"
                      className={theirForced.deafen ? 'voice-force on' : 'voice-force'}
                      title={theirForced.deafen ? 'Повернути звук' : 'Щоб учасник нікого не чув'}
                      aria-label={`Звук: ${member.displayName}`}
                      onClick={() =>
                        void forceVoice(boardId, {
                          userId: member.userId,
                          deafen: !theirForced.deafen,
                        }).catch(() => {})
                      }
                    >
                      {theirForced.deafen ? <HeadphonesOffIcon size={22} /> : <HeadphonesIcon size={22} />}
                    </button>
                  </>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* свій замок теж текстом: title на кнопці дістається лише миші */}
      {myLock && <span className="voice-note voice-error">{myLock}</span>}
      {full && <span className="voice-note">розмова повна ({VOICE_MAX_PARTICIPANTS})</span>}
      {error && <span className="voice-note voice-error">{error}</span>}

      {mini && (
        <button
          type="button"
          className={error || myLock ? 'voice-expand alert' : 'voice-expand'}
          title="Розмова"
          aria-label="Розмова"
          onClick={() => setExpanded(true)}
        >
          <HeadphonesIcon size={20} />
          {inVoice && <span className="voice-count">{peerIds.length + 1}</span>}
        </button>
      )}
      {narrow && expanded && (
        <button
          type="button"
          className="icon-button voice-collapse"
          title="Згорнути"
          aria-label="Згорнути"
          onClick={() => setExpanded(false)}
        >
          ×
        </button>
      )}
    </div>
  );
}
