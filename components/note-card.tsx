import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { PixelIcon } from './pixel-icon';
import { Button, Field, Panel, Tappable, tabularNums } from './ui';

import { startAudioPlayback } from '~/utils/audio';
import { ALLOWED_NOTE_TAGS, formatDuration, MonoNote } from '~/utils/notes';

export type NotePatch = {
  title?: string;
  transcript?: string;
  summary?: string;
  tags?: string[];
  actionItems?: MonoNote['actionItems'];
};

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
  onUpdate,
  onDelete,
  onRetry,
  onAudioError,
}: {
  note: MonoNote;
  onToggleAction: (noteId: number, actionId: string) => void;
  onUpdate?: (noteId: number, patch: NotePatch) => Promise<void> | void;
  onDelete?: (note: MonoNote) => void;
  onRetry?: (noteId: number) => void;
  onAudioError?: (message: string) => void;
}) {
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftTranscript, setDraftTranscript] = useState(note.transcript);
  const [draftTags, setDraftTags] = useState<string[]>(note.tags);
  const [draftActions, setDraftActions] = useState<MonoNote['actionItems']>(note.actionItems);
  const nextActionSeqRef = useRef(0);

  const summary = note.summary.trim();
  const transcript = note.transcript.trim();
  const hasDistinctSummary = Boolean(summary && transcript && summary !== transcript);

  const startEditing = () => {
    setEditError(null);
    setDraftTitle(note.title);
    setDraftTranscript(note.transcript);
    setDraftTags([...note.tags]);
    setDraftActions(note.actionItems.map((item) => ({ ...item })));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditError(null);
    setIsEditing(false);
  };

  const toggleDraftTag = (tag: string) => {
    setDraftTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const updateDraftActionText = (actionId: string, text: string) => {
    setDraftActions((prev) =>
      prev.map((item) => (item.id === actionId ? { ...item, text } : item))
    );
  };

  const removeDraftAction = (actionId: string) => {
    setDraftActions((prev) => prev.filter((item) => item.id !== actionId));
  };

  const addDraftAction = () => {
    nextActionSeqRef.current += 1;
    setDraftActions((prev) => [
      ...prev,
      { id: `act-${Date.now()}-${nextActionSeqRef.current}`, text: '', done: false },
    ]);
  };

  const saveEdit = async () => {
    if (!onUpdate || isSavingEdit) return;
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const nextTitle = draftTitle.trim() || note.title;
      const nextTranscript = draftTranscript.trim();
      const nextSummary = nextTranscript === note.transcript.trim() ? note.summary : '';
      const nextActions = draftActions
        .map((item) => ({ ...item, text: item.text.trim() }))
        .filter((item) => item.text.length > 0);
      await onUpdate(note.id, {
        title: nextTitle,
        transcript: nextTranscript,
        summary: nextSummary,
        tags: draftTags,
        actionItems: nextActions,
      });
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save note.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const editableTags = Array.from(new Set([...ALLOWED_NOTE_TAGS, 'voice', ...draftTags]));

  return (
    <Panel className="gap-2.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 font-pixel text-base text-ink" numberOfLines={1}>
          {note.title}
        </Text>
        <Text className="font-mono text-xs text-muted" style={tabularNums}>
          {note.localDate}
        </Text>
        {onUpdate ? (
          <Tappable
            onPress={isEditing ? cancelEditing : startEditing}
            accessibilityLabel={isEditing ? 'Cancel edit' : `Edit ${note.title}`}
            className="h-9 w-9 items-center justify-center rounded-md border border-line bg-bg">
            <PixelIcon name={isEditing ? 'close' : 'edit'} size={16} color="#d4cef0" />
          </Tappable>
        ) : null}
        {onDelete ? (
          <Tappable
            onPress={() => onDelete(note)}
            accessibilityLabel={`Delete ${note.title}`}
            className="h-9 w-9 items-center justify-center rounded-md border border-line bg-bg">
            <PixelIcon name="trash" size={16} color="#fca5a5" />
          </Tappable>
        ) : null}
      </View>

      {isEditing ? (
        <View className="gap-3 pt-1">
          <View className="gap-1">
            <Text className="font-mono text-xs text-muted">Title</Text>
            <Field value={draftTitle} onChangeText={setDraftTitle} placeholder="Note title" />
          </View>

          <View className="gap-1">
            <Text className="font-mono text-xs text-muted">Transcript</Text>
            <Field
              value={draftTranscript}
              onChangeText={setDraftTranscript}
              placeholder="Note text"
              multiline
            />
          </View>

          <View className="gap-1.5">
            <Text className="font-mono text-xs text-muted">Tags</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {editableTags.map((tag) => {
                const selected = draftTags.includes(tag);
                return (
                  <Tappable
                    key={tag}
                    onPress={() => toggleDraftTag(tag)}
                    className={`rounded-sm border px-2.5 py-1.5 ${
                      selected ? 'border-accent bg-accent' : 'border-line bg-bg'
                    }`}>
                    <Text
                      className={`font-mono-medium text-xs ${selected ? 'text-bg' : 'text-muted'}`}>
                      #{tag}
                    </Text>
                  </Tappable>
                );
              })}
            </View>
          </View>

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-mono text-xs text-muted">Tasks</Text>
              <Tappable
                onPress={addDraftAction}
                className="flex-row items-center gap-1 rounded-sm border border-line bg-bg px-2.5 py-1">
                <PixelIcon name="plus" size={16} color="#9d91cc" />
                <Text className="font-mono-medium text-xs text-ink">Add task</Text>
              </Tappable>
            </View>
            {draftActions.map((item) => (
              <View key={item.id} className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Field
                    value={item.text}
                    onChangeText={(text) => updateDraftActionText(item.id, text)}
                    placeholder="Task description"
                  />
                </View>
                <Tappable
                  onPress={() => removeDraftAction(item.id)}
                  accessibilityLabel="Remove task"
                  className="h-12 w-12 items-center justify-center rounded-md border border-line bg-bg">
                  <PixelIcon name="close" size={16} color="#fca5a5" />
                </Tappable>
              </View>
            ))}
          </View>

          {editError ? <Text className="font-mono text-xs text-red-200">{editError}</Text> : null}

          <View className="flex-row gap-2 pt-1">
            <View className="flex-1">
              <Button
                label="Cancel"
                variant="secondary"
                disabled={isSavingEdit}
                onPress={cancelEditing}
              />
            </View>
            <View className="flex-1">
              <Button label="Save" icon="check" loading={isSavingEdit} onPress={saveEdit} />
            </View>
          </View>
        </View>
      ) : (
        <>
          {note.audioState === 'pending' ? (
            <View className="flex-row items-center gap-2 rounded-md border border-line bg-bg px-3 py-2">
              <PixelIcon name="clock" size={16} color="#9d91cc" />
              <Text className="flex-1 font-mono text-xs text-muted">
                {note.lastError || 'Transcribing...'}
              </Text>
              {note.lastError && onRetry ? (
                <Tappable
                  onPress={() => onRetry(note.id)}
                  className="flex-row items-center gap-1 rounded-sm border border-line bg-panel px-2.5 py-1">
                  <PixelIcon name="refresh" size={16} color="#d4cef0" />
                  <Text className="font-mono-medium text-xs text-ink">Retry</Text>
                </Tappable>
              ) : null}
            </View>
          ) : note.audioState === 'failed' ? (
            <View className="flex-row items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="flex-1 font-mono text-xs text-red-200">
                {note.lastError || 'Transcription failed.'}
              </Text>
              {onRetry ? (
                <Tappable
                  onPress={() => onRetry(note.id)}
                  className="flex-row items-center gap-1 rounded-sm border border-danger/40 bg-bg px-2.5 py-1">
                  <PixelIcon name="refresh" size={16} color="#fca5a5" />
                  <Text className="font-mono-medium text-xs text-red-200">Retry</Text>
                </Tappable>
              ) : null}
            </View>
          ) : note.audioState === 'done' && note.extractEngine === 'regex' ? (
            <View className="flex-row items-center justify-between gap-2">
              <Text className="font-mono text-xs text-muted">Basic tags</Text>
              {onRetry ? (
                <Tappable
                  onPress={() => onRetry(note.id)}
                  className="flex-row items-center gap-1 rounded-sm border border-line bg-bg px-2 py-0.5">
                  <PixelIcon name="refresh" size={16} color="#9d91cc" />
                  <Text className="font-mono-medium text-xs text-muted">Retry</Text>
                </Tappable>
              ) : null}
            </View>
          ) : null}

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
            <AudioClipBar
              uri={note.audioUri}
              durationSec={note.durationSec}
              onError={onAudioError}
            />
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
        </>
      )}
    </Panel>
  );
}
