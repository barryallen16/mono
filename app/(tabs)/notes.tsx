import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteCard, NotePatch } from '~/components/note-card';
import { PixelIcon } from '~/components/pixel-icon';
import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  Panel,
  ScreenHeader,
  Sheet,
  SkeletonNoteCard,
  Tappable,
  tabularNums,
} from '~/components/ui';
import { stopActivePlayback } from '~/utils/audio';
import {
  deleteNote,
  MonoNote,
  processSavedNote,
  searchNotes,
  toggleActionItem,
  updateNote,
} from '~/utils/db';
import { ALLOWED_NOTE_TAGS } from '~/utils/notes';
import { addRecentSearch, clearRecentSearches, getRecentSearches } from '~/utils/onboarding';

const FILTERS = ['all', 'open', 'voice', ...ALLOWED_NOTE_TAGS] as const;
type NoteFilter = (typeof FILTERS)[number];
type NotesViewMode = 'notes' | 'tasks';

interface TaskRowItem {
  key: string;
  noteId: number;
  noteTitle: string;
  localDate: string;
  action: MonoNote['actionItems'][number];
}

export default function NotesScreen() {
  const [viewMode, setViewMode] = useState<NotesViewMode>('notes');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<NoteFilter>('all');
  const [notes, setNotes] = useState<MonoNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MonoNote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const debouncedQueryRef = useRef(debouncedQuery);
  const activeFilterRef = useRef(activeFilter);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const hasFocusedRef = useRef(false);

  debouncedQueryRef.current = debouncedQuery;
  activeFilterRef.current = activeFilter;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (searchText: string, filter: NoteFilter, isRefresh = false) => {
    const reqId = ++requestIdRef.current;
    if (isRefresh) setIsRefreshing(true);
    try {
      const dbTag = filter === 'open' ? 'all' : filter;
      const items = await searchNotes(searchText, dbTag);
      if (!mountedRef.current || requestIdRef.current !== reqId) return;
      setNotes(items);
      setError(null);
    } catch {
      if (!mountedRef.current || requestIdRef.current !== reqId) return;
      setError('Could not load local notes.');
    } finally {
      if (mountedRef.current && requestIdRef.current === reqId) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      hasFocusedRef.current = true;
      load(debouncedQueryRef.current, activeFilterRef.current);
      getRecentSearches()
        .then(setRecentSearches)
        .catch(() => {});
      return () => {
        stopActivePlayback();
      };
    }, [load])
  );

  useEffect(() => {
    if (!hasFocusedRef.current) return;
    load(debouncedQuery, activeFilter);
  }, [debouncedQuery, activeFilter, load]);

  const visibleNotes = useMemo(() => {
    if (activeFilter === 'open') {
      return notes.filter((note) => note.actionItems.some((item) => !item.done));
    }
    if (activeFilter === 'all') return notes;
    return notes.filter((note) => note.tags.includes(activeFilter));
  }, [notes, activeFilter]);

  const taskRows = useMemo<TaskRowItem[]>(() => {
    const items: TaskRowItem[] = [];
    for (const note of visibleNotes) {
      for (const action of note.actionItems) {
        if (activeFilter === 'open' && action.done) continue;
        items.push({
          key: `${note.id}:${action.id}`,
          noteId: note.id,
          noteTitle: note.title,
          localDate: note.localDate,
          action,
        });
      }
    }
    return items.sort((a, b) => Number(a.action.done) - Number(b.action.done));
  }, [visibleNotes, activeFilter]);

  const openTaskCount = useMemo(
    () => taskRows.reduce((count, row) => count + (row.action.done ? 0 : 1), 0),
    [taskRows]
  );

  const handleToggleAction = async (noteId: number, actionId: string) => {
    try {
      const updated = await toggleActionItem(noteId, actionId);
      if (updated && mountedRef.current) {
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
    } catch {
      if (mountedRef.current) setError('Could not update task state.');
    }
  };

  const handleUpdate = async (noteId: number, patch: NotePatch) => {
    try {
      const updated = await updateNote(noteId, patch);
      if (updated && mountedRef.current) {
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Could not save note changes.');
      }
      throw err;
    }
  };

  const handleRetry = (noteId: number) => {
    setError(null);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? {
              ...n,
              audioState: n.audioUri ? 'pending' : n.audioState,
              lastError: null,
            }
          : n
      )
    );
    processSavedNote(noteId)
      .then((updated) => {
        if (!mountedRef.current || !updated) return;
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not reprocess note.');
        load(debouncedQueryRef.current, activeFilterRef.current);
      });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteNote(confirmDelete.id);
      if (!mountedRef.current) return;
      setNotes((prev) => prev.filter((n) => n.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch {
      if (mountedRef.current) setError('Could not delete note.');
    } finally {
      if (mountedRef.current) setIsDeleting(false);
    }
  };

  const handleSearchSubmit = () => {
    const trimmed = query.trim();
    if (trimmed) {
      addRecentSearch(trimmed)
        .then(setRecentSearches)
        .catch(() => {});
    }
  };

  const applyRecentSearch = (term: string) => {
    setQuery(term);
    setDebouncedQuery(term);
  };

  const handleClearRecents = () => {
    clearRecentSearches()
      .then(() => setRecentSearches([]))
      .catch(() => {});
  };

  const showRecents = !query && recentSearches.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScreenHeader
        title={viewMode === 'tasks' ? 'Tasks' : 'Notes'}
        subtitle={
          viewMode === 'tasks'
            ? 'Checkable todos extracted from your notes'
            : 'Search and manage saved notes'
        }
        right={
          <Text className="font-mono text-xs text-muted" style={tabularNums}>
            {viewMode === 'tasks'
              ? `${openTaskCount} open`
              : `${visibleNotes.length} ${visibleNotes.length === 1 ? 'note' : 'notes'}`}
          </Text>
        }
      />

      <View className="border-b border-line bg-bg px-4 py-3">
        <View className="w-full max-w-2xl gap-3 self-center">
          <View className="flex-row gap-2">
            {(
              [
                { mode: 'notes', label: 'Notes', icon: 'notes' },
                {
                  mode: 'tasks',
                  label: openTaskCount > 0 ? `Tasks (${openTaskCount})` : 'Tasks',
                  icon: 'checkbox-on',
                },
              ] as const
            ).map((tab) => {
              const active = viewMode === tab.mode;
              return (
                <Tappable
                  key={tab.mode}
                  onPress={() => setViewMode(tab.mode)}
                  className={`min-h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-md border px-3 ${
                    active ? 'border-accent bg-accent' : 'border-line bg-panel'
                  }`}>
                  <PixelIcon name={tab.icon} size={16} color={active ? '#07256c' : '#d4cef0'} />
                  <Text
                    className={`font-mono-semibold text-xs ${
                      active ? 'text-on-accent' : 'text-ink'
                    }`}
                    style={tabularNums}>
                    {tab.label}
                  </Text>
                </Tappable>
              );
            })}
          </View>

          <Field
            placeholder={
              viewMode === 'tasks'
                ? 'Filter tasks or note titles...'
                : 'Search transcripts, titles, #tags...'
            }
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearchSubmit}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            leftIcon="search"
            onClear={query ? () => setQuery('') : undefined}
          />

          {showRecents ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-mono text-xs text-muted">Recent:</Text>
              {recentSearches.map((term) => (
                <Tappable
                  key={term}
                  onPress={() => applyRecentSearch(term)}
                  className="min-h-8 items-center justify-center rounded-sm border border-line-subtle bg-bg px-2.5">
                  <Text className="font-mono text-xs text-muted">{term}</Text>
                </Tappable>
              ))}
              <Tappable
                onPress={handleClearRecents}
                accessibilityLabel="Clear recent searches"
                className="min-h-8 items-center justify-center px-1">
                <Text className="font-mono text-xs text-accent">Clear</Text>
              </Tappable>
            </View>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {FILTERS.map((filter) => {
                const active = activeFilter === filter;
                const label = filter === 'all' || filter === 'open' ? filter : `#${filter}`;
                return (
                  <Tappable
                    key={filter}
                    onPress={() => setActiveFilter(filter)}
                    className={`min-h-10 items-center justify-center rounded-md border px-3 ${
                      active ? 'border-accent bg-accent' : 'border-line bg-panel'
                    }`}>
                    <Text
                      className={`font-mono-medium text-xs ${active ? 'text-on-accent' : 'text-muted'}`}>
                      {label}
                    </Text>
                  </Tappable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>

      {viewMode === 'tasks' ? (
        <FlatList
          data={taskRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshing={isRefreshing}
          onRefresh={() => load(debouncedQueryRef.current, activeFilterRef.current, true)}
          ListHeaderComponent={
            error ? (
              <View className="mb-3 w-full max-w-2xl self-center">
                <ErrorBanner
                  onRetry={() => load(debouncedQueryRef.current, activeFilterRef.current)}>
                  {error}
                </ErrorBanner>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View className="h-2.5" />}
          renderItem={({ item }) => (
            <View className="w-full max-w-2xl self-center">
              <Panel className="p-0">
                <Tappable
                  onPress={() => handleToggleAction(item.noteId, item.action.id)}
                  accessibilityLabel={`${item.action.done ? 'Mark incomplete' : 'Complete'} ${item.action.text}`}
                  className="min-h-12 flex-row items-start gap-3 px-4 py-3">
                  <View className="mt-0.5">
                    <PixelIcon
                      name={item.action.done ? 'checkbox-on' : 'checkbox'}
                      size={16}
                      color={item.action.done ? '#9d91cc' : '#d4cef0'}
                    />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text
                      className={`font-mono text-sm leading-5 ${
                        item.action.done ? 'text-muted line-through' : 'text-ink'
                      }`}>
                      {item.action.text}
                    </Text>
                    <Text className="font-mono text-xs text-muted" style={tabularNums}>
                      {item.noteTitle} - {item.localDate}
                    </Text>
                  </View>
                </Tappable>
              </Panel>
            </View>
          )}
          ListEmptyComponent={
            isLoading ? (
              <View className="w-full max-w-2xl gap-3 self-center">
                <SkeletonNoteCard />
                <SkeletonNoteCard />
              </View>
            ) : (
              <View className="w-full max-w-2xl self-center">
                <EmptyState
                  icon="check"
                  title={activeFilter === 'open' ? 'No open tasks' : 'No matching tasks'}
                  description={
                    query
                      ? `No tasks matched "${query}". Try a different keyword or clear your search.`
                      : 'Record or type a note with a todo to see it listed here.'
                  }
                  actionLabel={query ? 'Clear search' : undefined}
                  actionIcon={query ? 'close' : undefined}
                  actionVariant="secondary"
                  onAction={query ? () => setQuery('') : undefined}
                />
              </View>
            )
          }
        />
      ) : (
        <FlatList
          data={visibleNotes}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshing={isRefreshing}
          onRefresh={() => load(debouncedQueryRef.current, activeFilterRef.current, true)}
          ListHeaderComponent={
            error ? (
              <View className="mb-3 w-full max-w-2xl self-center">
                <ErrorBanner
                  onRetry={() => load(debouncedQueryRef.current, activeFilterRef.current)}>
                  {error}
                </ErrorBanner>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => (
            <View className="w-full max-w-2xl self-center">
              <NoteCard
                note={item}
                onToggleAction={handleToggleAction}
                onUpdate={handleUpdate}
                onDelete={setConfirmDelete}
                onRetry={handleRetry}
                onAudioError={setError}
              />
            </View>
          )}
          ListEmptyComponent={
            isLoading ? (
              <View className="w-full max-w-2xl gap-3 self-center">
                <SkeletonNoteCard />
                <SkeletonNoteCard />
              </View>
            ) : (
              <View className="w-full max-w-2xl self-center">
                <EmptyState
                  icon="search"
                  title="No matching notes"
                  description={
                    query
                      ? `Nothing matched "${query}". Try a different keyword or clear your search.`
                      : 'Try another keyword or switch back to all notes.'
                  }
                  actionLabel={query ? 'Clear search' : undefined}
                  actionIcon={query ? 'close' : undefined}
                  actionVariant="secondary"
                  onAction={query ? () => setQuery('') : undefined}
                />
              </View>
            )
          }
        />
      )}

      <Sheet
        visible={confirmDelete !== null}
        onClose={() => !isDeleting && setConfirmDelete(null)}
        title="Delete entry?">
        <View className="gap-4">
          <Text className="font-mono text-xs leading-5 text-muted">
            This removes the entry and its saved audio clip from local storage.
          </Text>
          <View className="gap-2.5">
            <Button
              label="Delete"
              icon="trash"
              variant="danger"
              loading={isDeleting}
              onPress={handleConfirmDelete}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={isDeleting}
              onPress={() => setConfirmDelete(null)}
            />
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
