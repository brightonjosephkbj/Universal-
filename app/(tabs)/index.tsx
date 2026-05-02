import {
  ScrollView, TextInput, Pressable, Text, View,
  ActivityIndicator, Image, Alert, FlatList, RefreshControl,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api, VideoInfo, Download,
  formatBytes, formatSpeed, formatEta, platformColor, platformIcon,
} from '@/lib/api';
import { C } from '@/lib/theme';

const PLATFORMS = [
  { id: 'youtube',    label: 'YouTube',    color: '#FF0000', icon: '▶' },
  { id: 'tiktok',     label: 'TikTok',     color: '#69C9D0', icon: '♪' },
  { id: 'instagram',  label: 'Instagram',  color: '#E1306C', icon: '◈' },
  { id: 'soundcloud', label: 'SoundCloud', color: '#FF5500', icon: '☁' },
  { id: 'twitter',    label: 'Twitter/X',  color: '#1DA1F2', icon: '𝕏' },
  { id: 'facebook',   label: 'Facebook',   color: '#1877F2', icon: 'f' },
  { id: 'vimeo',      label: 'Vimeo',      color: '#1AB7EA', icon: '◉' },
  { id: 'web',        label: 'Other',      color: '#00B4D8', icon: '◎' },
];

const FORMATS = [
  { id: 'mp4',  label: 'MP4',  sub: 'Video' },
  { id: 'mp3',  label: 'MP3',  sub: 'Audio' },
  { id: 'mkv',  label: 'MKV',  sub: 'Video' },
  { id: 'aac',  label: 'AAC',  sub: 'Audio' },
  { id: 'flac', label: 'FLAC', sub: 'Lossless' },
  { id: 'm4a',  label: 'M4A',  sub: 'Audio' },
];

const QUALITIES_VIDEO = [
  { id: '360p',  label: '360p',  sub: 'Low' },
  { id: '480p',  label: '480p',  sub: 'SD' },
  { id: '720p',  label: '720p',  sub: 'HD' },
  { id: '1080p', label: '1080p', sub: 'FHD' },
  { id: '1440p', label: '1440p', sub: '2K' },
  { id: '2160p', label: '4K',    sub: 'UHD' },
];

const QUALITIES_AUDIO = [
  { id: '128kbps', label: '128k', sub: 'Standard' },
  { id: '320kbps', label: '320k', sub: 'High' },
];

const AUDIO_FORMATS = ['mp3', 'aac', 'flac', 'm4a'];

function Chip({
  label, sub, active, color, onPress,
}: { label: string; sub?: string; active: boolean; color?: string; onPress: () => void }) {
  const accent = color || C.primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
        borderWidth: 1.5, borderColor: active ? accent : C.border,
        backgroundColor: active ? accent + '22' : C.surface,
        opacity: pressed ? 0.7 : 1, marginRight: 8, marginBottom: 8,
        flexDirection: 'row', alignItems: 'center', gap: 4,
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: active ? accent : C.muted }}>{label}</Text>
      {sub && <Text style={{ fontSize: 10, color: active ? accent + 'BB' : C.muted + '66' }}>{sub}</Text>}
    </Pressable>
  );
}

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <View style={{ height: 4, backgroundColor: color + '33', borderRadius: 2, overflow: 'hidden', marginVertical: 6 }}>
      <View style={{ width: `${Math.max(2, progress)}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

function DownloadCard({ item, onCancel }: { item: Download; onCancel: () => void }) {
  const isActive = item.status === 'downloading' || item.status === 'pending';
  const statusColors: Record<string, string> = {
    pending: C.muted, downloading: C.primary, completed: C.success,
    failed: C.error, paused: C.warning,
  };
  const sc = statusColors[item.status] || C.muted;

  return (
    <View style={{
      backgroundColor: C.surface, borderRadius: 14, padding: 14,
      marginBottom: 10, borderWidth: 1, borderColor: C.border,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{
          width: 38, height: 38, borderRadius: 10,
          backgroundColor: platformColor(item.platform) + '22',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 17, color: platformColor(item.platform) }}>
            {platformIcon(item.platform)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {item.format.toUpperCase()} · {item.quality}
            {item.file_size > 0 ? ` · ${formatBytes(item.file_size)}` : ''}
          </Text>
        </View>
        <View style={{ backgroundColor: sc + '22', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 }}>
          <Text style={{ fontSize: 9, fontWeight: '800', color: sc }}>{item.status.toUpperCase()}</Text>
        </View>
      </View>

      {(isActive || item.status === 'paused') && (
        <>
          <ProgressBar progress={item.progress} color={sc} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: sc }}>{item.progress}%</Text>
            <Text style={{ fontSize: 11, color: C.muted }}>
              {item.speed > 0 ? formatSpeed(item.speed) : ''}
              {item.eta > 0 ? `  ⏱ ${formatEta(item.eta)}` : ''}
            </Text>
          </View>
        </>
      )}
      {item.status === 'completed' && <ProgressBar progress={100} color={C.success} />}
      {item.status === 'failed' && item.error_message && (
        <Text style={{ fontSize: 12, color: C.error, marginTop: 6 }} numberOfLines={2}>
          ⚠ {item.error_message}
        </Text>
      )}

      {item.status !== 'completed' && (
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => ({
            marginTop: 10, paddingVertical: 8, borderRadius: 9,
            borderWidth: 1, borderColor: C.error + '55',
            backgroundColor: C.error + '12', alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.error }}>✕  Cancel</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  // Download form state
  const [url, setUrl]             = useState('');
  const [format, setFormat]       = useState('mp4');
  const [quality, setQuality]     = useState('720p');
  const [info, setInfo]           = useState<VideoInfo | null>(null);
  const [fetching, setFetching]   = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [success, setSuccess]     = useState(false);

  // Active downloads list
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAudio = AUDIO_FORMATS.includes(format);

  const fetchDownloads = useCallback(async () => {
    try {
      const data = await api.downloads.list();
      // show only recent 10 on home
      setDownloads(data.slice(0, 10));
    } catch {}
  }, []);

  useEffect(() => {
    fetchDownloads();
    pollRef.current = setInterval(fetchDownloads, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchDownloads]);

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) { setUrl(text); setInfo(null); setSuccess(false); }
    } catch {}
  };

  const handleFetchInfo = async () => {
    if (!url.trim()) return;
    setFetching(true); setInfo(null);
    try {
      const data = await api.info(url.trim());
      setInfo(data);
    } catch (err: any) {
      Alert.alert('Could not fetch info', err.message || 'Check the URL and try again.');
    } finally { setFetching(false); }
  };

  const handleDownload = async () => {
    if (!url.trim()) { Alert.alert('No URL', 'Paste a URL first.'); return; }
    setDownloading(true);
    try {
      await api.downloads.create({ url: url.trim(), format, quality });
      setSuccess(true);
      setUrl(''); setInfo(null);
      setTimeout(() => setSuccess(false), 3000);
      fetchDownloads();
    } catch (err: any) {
      Alert.alert('Download failed', err.message || 'Server error. Is your server running?');
    } finally { setDownloading(false); }
  };

  const handleCancel = async (id: string) => {
    await api.downloads.cancel(id).catch(() => {});
    setDownloads(prev => prev.filter(d => d.id !== id));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDownloads();
    setRefreshing(false);
  };

  const activeCount = downloads.filter(d => d.status === 'downloading' || d.status === 'pending').length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 20, paddingHorizontal: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* Header */}
        <View style={{ marginBottom: 22 }}>
          <Text style={{ fontSize: 30, fontWeight: '900', color: C.text, letterSpacing: -0.5 }}>
            Download
          </Text>
          <Text style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>
            Paste any URL and hit download
          </Text>
        </View>

        {/* URL Input */}
        <View style={{
          backgroundColor: C.surface, borderRadius: 16,
          borderWidth: 1.5, borderColor: url.trim() ? C.primary : C.border,
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 14, marginBottom: 12,
        }}>
          <Text style={{ fontSize: 18, color: C.muted, marginRight: 10 }}>🔗</Text>
          <TextInput
            value={url}
            onChangeText={v => { setUrl(v); setInfo(null); setSuccess(false); }}
            placeholder="Paste URL here..."
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={{ flex: 1, color: C.text, fontSize: 14, paddingVertical: 15 }}
          />
          {url.length > 0 && (
            <Pressable onPress={() => { setUrl(''); setInfo(null); }} style={{ padding: 6 }}>
              <Text style={{ color: C.muted, fontSize: 18 }}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* Paste + Fetch row */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
          <Pressable
            onPress={handlePaste}
            style={({ pressed }) => ({
              flex: 1, paddingVertical: 12, borderRadius: 12,
              backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border,
              alignItems: 'center', opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: C.text, fontWeight: '600', fontSize: 13 }}>📋  Paste</Text>
          </Pressable>
          <Pressable
            onPress={handleFetchInfo}
            disabled={!url.trim() || fetching}
            style={({ pressed }) => ({
              flex: 2, paddingVertical: 12, borderRadius: 12,
              backgroundColor: url.trim() ? C.primary : C.border,
              alignItems: 'center', opacity: pressed ? 0.75 : 1,
            })}
          >
            {fetching
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>🔍  Fetch Info</Text>
            }
          </Pressable>
        </View>

        {/* Info preview card */}
        {info && (
          <View style={{
            backgroundColor: C.surface, borderRadius: 16,
            borderWidth: 1, borderColor: C.border, marginBottom: 18, overflow: 'hidden',
          }}>
            {info.thumbnail && (
              <Image source={{ uri: info.thumbnail }} style={{ width: '100%', height: 170 }} resizeMode="cover" />
            )}
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <View style={{ backgroundColor: platformColor(info.platform) + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: platformColor(info.platform) }}>
                    {info.platform.toUpperCase()}
                  </Text>
                </View>
                {info.duration && (
                  <Text style={{ fontSize: 12, color: C.muted }}>
                    ⏱ {Math.floor(info.duration / 60)}:{String(Math.floor(info.duration % 60)).padStart(2, '0')}
                  </Text>
                )}
              </View>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, lineHeight: 21 }} numberOfLines={2}>
                {info.title}
              </Text>
              {info.uploader && (
                <Text style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{info.uploader}</Text>
              )}
            </View>
          </View>
        )}

        {/* Popular Platforms */}
        {!info && !url.trim() && (
          <View style={{ marginBottom: 18 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
              Popular Platforms
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PLATFORMS.slice(0, 6).map(p => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    Alert.alert(p.label, `Paste a ${p.label} URL in the box above and tap Download.`);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
                    backgroundColor: p.color + '18', borderWidth: 1.5, borderColor: p.color + '44',
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: 13, color: p.color }}>{p.icon}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: p.color }}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Format */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            Format
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {FORMATS.map(f => (
              <Chip
                key={f.id} label={f.label} sub={f.sub}
                active={format === f.id}
                onPress={() => {
                  setFormat(f.id);
                  if (AUDIO_FORMATS.includes(f.id)) setQuality('320kbps');
                  else setQuality('720p');
                }}
              />
            ))}
          </View>
        </View>

        {/* Quality */}
        <View style={{ marginBottom: 22 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            {isAudio ? 'Bitrate' : 'Quality'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(isAudio ? QUALITIES_AUDIO : QUALITIES_VIDEO).map(q => (
              <Chip
                key={q.id} label={q.label} sub={q.sub}
                active={quality === q.id}
                onPress={() => setQuality(q.id)}
              />
            ))}
          </View>
        </View>

        {/* Download Button */}
        <Pressable
          onPress={handleDownload}
          disabled={!url.trim() || downloading || success}
          style={({ pressed }) => ({
            paddingVertical: 17, borderRadius: 16, alignItems: 'center',
            backgroundColor: success ? C.success : !url.trim() ? C.border : C.primary,
            opacity: pressed ? 0.8 : 1,
            shadowColor: C.primary, shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.4, shadowRadius: 14, elevation: 10,
          })}
        >
          {downloading
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 0.5 }}>
                {success ? '✓  Added to Queue' : `⬇  Download ${format.toUpperCase()}`}
              </Text>
          }
        </Pressable>

        <Text style={{ textAlign: 'center', color: C.muted, fontSize: 12, marginTop: 14, lineHeight: 18 }}>
          Supports YouTube, TikTok, Instagram, SoundCloud, Twitter/X, Vimeo, Facebook and 1000+ sites
        </Text>

        {/* Recent Downloads */}
        {downloads.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>Recent Downloads</Text>
              {activeCount > 0 && (
                <View style={{ backgroundColor: C.primary + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.primary }}>{activeCount} active</Text>
                </View>
              )}
            </View>
            {downloads.map(item => (
              <DownloadCard key={item.id} item={item} onCancel={() => handleCancel(item.id)} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
