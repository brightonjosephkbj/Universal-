import {
  FlatList, Pressable, Text, View, TextInput,
  ActivityIndicator, Image, Alert, RefreshControl,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api, LibraryItem, formatBytes, formatDuration } from '@/lib/api';
import { C } from '@/lib/theme';

const TYPE_ICON:  Record<string, string> = { video: '▶', audio: '♪', podcast: '🎙', image: '◈' };
const TYPE_COLOR: Record<string, string> = { video: '#00B4D8', audio: '#FF6B9D', podcast: '#FFB020', image: '#00D9A3' };

const FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'video',   label: 'Videos' },
  { key: 'audio',   label: 'Audio' },
  { key: 'podcast', label: 'Podcasts' },
];

function Thumb({ item, size = 54 }: { item: LibraryItem; size?: number }) {
  const color = TYPE_COLOR[item.type] || C.primary;
  if (item.thumbnail)
    return <Image source={{ uri: item.thumbnail }} style={{ width: size, height: size, borderRadius: size * 0.2 }} resizeMode="cover" />;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.2, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.38, color }}>{TYPE_ICON[item.type] || '◎'}</Text>
    </View>
  );
}

function ListCard({ item, onDelete, onPlay }: { item: LibraryItem; onDelete: () => void; onPlay: () => void }) {
  return (
    <Pressable
      onPress={onPlay}
      onLongPress={() =>
        Alert.alert('Options', item.title, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onDelete },
        ])
      }
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <View style={{
        backgroundColor: C.surface, borderRadius: 14, padding: 12,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        marginBottom: 8, borderWidth: 1, borderColor: C.border,
      }}>
        <Thumb item={item} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{item.title}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
            <View style={{ backgroundColor: (TYPE_COLOR[item.type] || C.primary) + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: TYPE_COLOR[item.type] || C.primary }}>
                {item.type.toUpperCase()}
              </Text>
            </View>
            {item.format && <Text style={{ fontSize: 11, color: C.muted }}>{item.format.toUpperCase()}</Text>}
            {item.duration != null && <Text style={{ fontSize: 11, color: C.muted }}>· {formatDuration(item.duration)}</Text>}
            {item.file_size > 0 && <Text style={{ fontSize: 11, color: C.muted }}>· {formatBytes(item.file_size)}</Text>}
          </View>
          {item.artist && <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{item.artist}</Text>}
        </View>
        <Text style={{ color: C.muted, fontSize: 22 }}>›</Text>
      </View>
    </Pressable>
  );
}

function GridCard({ item, onDelete, onPlay }: { item: LibraryItem; onDelete: () => void; onPlay: () => void }) {
  return (
    <Pressable
      onPress={onPlay}
      onLongPress={() =>
        Alert.alert('Options', item.title, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onDelete },
        ])
      }
      style={({ pressed }) => ({ flex: 1, margin: 5, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
        <View style={{ width: '100%', aspectRatio: 1.4, backgroundColor: C.elevated }}>
          {item.thumbnail
            ? <Image source={{ uri: item.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 34, color: TYPE_COLOR[item.type] || C.primary }}>{TYPE_ICON[item.type] || '◎'}</Text>
              </View>
          }
          <View style={{ position: 'absolute', bottom: 5, left: 5, backgroundColor: '#000A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
            <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>{(item.format || item.type).toUpperCase()}</Text>
          </View>
          {item.duration != null && (
            <View style={{ position: 'absolute', bottom: 5, right: 5, backgroundColor: '#000A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
              <Text style={{ fontSize: 9, color: '#fff' }}>{formatDuration(item.duration)}</Text>
            </View>
          )}
        </View>
        <View style={{ padding: 9 }}>
          <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }} numberOfLines={2}>{item.title}</Text>
          {item.artist && <Text style={{ color: C.muted, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{item.artist}</Text>}
          <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>{formatBytes(item.file_size)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems]       = useState<LibraryItem[]>([]);
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [grid, setGrid]         = useState(false);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats]       = useState({ total: 0, totalSize: 0 });

  const load = useCallback(async () => {
    try {
      const [data, s] = await Promise.all([
        api.library.list({ type: filter === 'all' ? undefined : filter, q: search || undefined }),
        api.library.stats(),
      ]);
      setItems(data);
      setStats(s);
    } catch {}
  }, [filter, search]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleDelete = async (id: string) => {
    await api.library.delete(id).catch(() => {});
    setItems(prev => prev.filter(i => i.id !== id));
    api.library.stats().then(s => setStats(s)).catch(() => {});
  };

  const handlePlay = (item: LibraryItem) => {
    // Navigate to player with item id
    router.push({ pathname: '/(tabs)/player', params: { id: item.id, title: item.title, type: item.type } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View>
            <Text style={{ fontSize: 30, fontWeight: '900', color: C.text, letterSpacing: -0.5 }}>Library</Text>
            <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
              {stats.total} items · {formatBytes(stats.totalSize)}
            </Text>
          </View>
          <Pressable
            onPress={() => setGrid(g => !g)}
            style={({ pressed }) => ({
              width: 40, height: 40, borderRadius: 12,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 18, color: C.muted }}>{grid ? '☰' : '⊞'}</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: C.surface, borderRadius: 12,
          borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, marginBottom: 12,
        }}>
          <Text style={{ color: C.muted, fontSize: 16 }}>🔍</Text>
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search library..." placeholderTextColor={C.muted}
            style={{ flex: 1, color: C.text, fontSize: 14, paddingVertical: 11 }}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}><Text style={{ color: C.muted, fontSize: 16 }}>✕</Text></Pressable>
          )}
        </View>

        {/* Filters */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {FILTERS.map(f => (
            <Pressable
              key={f.key} onPress={() => setFilter(f.key)}
              style={({ pressed }) => ({
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
                backgroundColor: filter === f.key ? C.primary : C.surface,
                borderWidth: 1, borderColor: filter === f.key ? C.primary : C.border,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: filter === f.key ? '#fff' : C.muted }}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 52, marginBottom: 14 }}>📂</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 8 }}>
            {search ? 'No results' : 'Library is empty'}
          </Text>
          <Text style={{ fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 21 }}>
            {search ? 'Try a different search' : 'Download media from the\nHome tab to see it here'}
          </Text>
        </View>
      ) : grid ? (
        <FlatList
          data={items} keyExtractor={i => i.id} numColumns={2}
          contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          renderItem={({ item }) => (
            <GridCard item={item} onDelete={() => handleDelete(item.id)} onPlay={() => handlePlay(item)} />
          )}
        />
      ) : (
        <FlatList
          data={items} keyExtractor={i => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          renderItem={({ item }) => (
            <ListCard item={item} onDelete={() => handleDelete(item.id)} onPlay={() => handlePlay(item)} />
          )}
        />
      )}
    </View>
  );
}
