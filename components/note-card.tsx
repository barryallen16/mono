import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { PixelIcon } from './pixel-icon';
import { Panel, Tappable, tabularNums } from './ui';

import { startAudioPlayback } from '~/utils/audio';
import { formatDuration, MonoNote } from '~/utils/notes';

export function AudioClipBar({
  uri,
  durationSec,
  label = 'Play clip',
  onError,
}: {
  uri: string;
  durationSec: number;
  label?: string;
  onError?: (message: string) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [reportedDuration, setReportedDuration] = useState(0);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    requestSeqRef.current += 1;
    setIsPlaying(false);
    setPositionSec(0);
    setReportedDuration(0);
    const stop = stopRef.current;
    stopRef.current = null;
    if (stop) stop();

    return () => {
      requestSeqRef.current += 1;
      const activeStop = stopRef.current;
      stopRef.current = null;
      if (activeStop) activeStop();
    };
  }, [uri]);

  const totalSec = Math.max(durationSec, reportedDuration);

  const handlePress = async () => {
    if (isPlaying) {
      requestSeqRef.current += 1;
      setIsPlaying(false);
      setPositionSec(0);
      const stop = stopRef.current;
      stopRef.current = null;
      if (stop) await stop();
      return;
    }

    const reqId = ++requestSeqRef.current;
    setIsPlaying(true);
    setPositionSec(0);

    try {
      const stop = await startAudioPlayback(
        uri,
        (state) => {
          if (!mountedRef.current || requestSeqRef.current !== reqId) return;
          setIsPlaying(state.isPlaying);
          setPositionSec(state.positionSec);
          if (state.durationSec > 0) setReportedDuration(state.durationSec);
        },
        () => {
          if (!mountedRef.current || requestSeqRef.current !== reqId) return;
          stopRef.current = null;
          setIsPlaying(false);
          setPositionSec(0);
        }
      );

      if (!mountedRef.current || requestSeqRef.current !== reqId) {
        await stop();
        return;
      }
      stopRef.current = stop;
    } catch {
      if (!mountedRef.current || requestSeqRef.current !== reqId) return;
      stopRef.current = null;
      setIsPlaying(false);
      setPositionSec(0);
      onError?.('Could not play audio clip.');
    }
  };

  return (
    <Tappable
      onPress={handlePress}
      accessibilityLabel={isPlaying ? 'Stop audio clip' : 'Play audio clip'}
      className={`min-h-10 flex-row items-center justify-between gap-3 rounded-md border px-3 py-2 ${
        isPlaying ? 'border-accent bg-accent/15' : 'border-line bg-bg'
      }`}>
      <View className="flex-row items-center gap-2">
        <PixelIcon name={isPlaying ? 'square' : 'play'} size={16} color="#9d91cc" />
        <Text className="font-mono-medium text-xs text-ink">
          {isPlaying ? 'Stop playback' : label}
        </Text>
      </View>
      <Text className="font-mono text-xs text-muted" style={tabularNums}>
        {isPlaying && totalSec > 0
          ? `${formatDuration(positionSec)} / ${formatDuration(totalSec)}`
          : formatDuration(totalSec)}
      </Text>
    </Tappable>
  );
}

export function NoteCard({
  note,
  onToggleAction,
  onAudioError,
}: {
  note: MonoNote;
  onToggleAction: (noteId: number, actionId: string) => void;
  onAudioError?: (message: string) => void;
}) {
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const summary = note.summary.trim();
  const transcript = note.transcript.trim();
  const hasDistinctSummary = Boolean(summary && transcript && summary !== transcript);

  return (
    <Panel className="gap-2.5">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 font-pixel text-base text-ink" numberOfLines={1}>
          {note.title}
        </Text>
        <Text className="font-mono text-xs text-muted" style={tabularNums}>
          {note.localDate}
        </Text>
      </View>

      {hasDistinctSummary ? (
        <View className="gap-1.5">
          <Text className="font-mono text-sm leading-6 text-ink">{summary}</Text>
          <Tappable
            onPress={() => setShowFullTranscript((v) => !v)}
            accessibilityLabel={
              showFullTranscript ? 'Hide full transcript' : 'Show full transcript'
            }
            className="self-start py-0.5">
            <Text className="font-mono-medium text-xs text-accent">
              {showFullTranscript ? 'Hide transcript' : 'Show transcript'}
            </Text>
          </Tappable>
          {showFullTranscript ? (
            <View className="rounded-md border border-line bg-bg px-3 py-2">
              <Text className="font-mono text-xs leading-5 text-muted">{transcript}</Text>
            </View>
          ) : null}
        </View>
      ) : transcript ? (
        <Text className="font-mono text-sm leading-6 text-ink">{transcript}</Text>
      ) : null}

      {note.audioUri ? (
        <AudioClipBar uri={note.audioUri} durationSec={note.durationSec} onError={onAudioError} />
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        {note.tags.map((tag) => (
          <View key={tag} className="rounded-sm border border-line bg-bg px-2 py-0.5">
            <Text className="font-mono text-xs text-muted">#{tag}</Text>
          </View>
        ))}
      </View>

      {note.actionItems.length > 0 ? (
        <View className="mt-1 gap-1.5 border-t border-line pt-2.5">
          {note.actionItems.map((item) => (
            <Tappable
              key={item.id}
              onPress={() => onToggleAction(note.id, item.id)}
              className="min-h-10 flex-row items-center gap-2">
              <PixelIcon
                name={item.done ? 'checkbox-on' : 'checkbox'}
                size={16}
                color={item.done ? '#9d91cc' : '#d4cef0'}
              />
              <Text
                className={`flex-1 font-mono text-xs leading-5 ${
                  item.done ? 'text-muted line-through' : 'text-ink'
                }`}>
                {item.text}
              </Text>
            </Tappable>
          ))}
        </View>
      ) : null}
    </Panel>
  );
}
