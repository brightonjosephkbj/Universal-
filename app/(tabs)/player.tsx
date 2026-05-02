import {
  View, Text, Pressable, ScrollView, ActivityIndicator, Image, Alert,
} from 'react-native';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import { api, LibraryItem, formatDuration, formatBytes } from '@/lib/api';
import { C } from '@/lib/theme';

type EqPreset = 'Normal' | 'Bass' | 'Treble' | 'Custom';

const EQ_PRESETS: EqPreset[] = ['Normal', 'Bass', 'Treble', 'Custom'];

function Slider({
  value, min = 0, max = 1, onChange,
}: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <View style={{ height: 32, justifyContent: 'center' }}>
      <View style={{ height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'visible' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: C.primary, borderRadius: 2 }} />
      </View>
    </View>
  );
}

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; title?: string; type?: string }>();

  const [library, setLibrary]         = useState<LibraryItem[]>([]);
  const [current, setCurrent]         = useState<LibraryItem | null>(null);
  const [loading, setLoading]         = useState(false);
  const [playing, setPlaying]         = useState(false);
  const [position, setPosition]       = useState(0);
  const [duration, setDuration]       = useState(0);
  const [volume, setVolume]           = useState(0.8);
  const [eq, setEq]                   = useState<EqPreset>('Normal');
  const [shuffle, setShuffle]         = useState(false);
  const [repeat, setRepeat]           = useState(false);
  const [streamUrl, setStreamUrl]     = useState<string | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);

  // Load library on mount
  useEffect(() => {
    api.library.list({ type: 'audio' })
      .then(data => setLibrary(data))
      .catch(() => {});
  }, []);

  // If navigated here with an item id, load it
  useEffect(() => {
    if (params.id) {
      api.library.get(params.id).then(item => loadItem(item)).catch(() => {});
    }
  }, [params.id]);

  const loadItem = useCallback(async (item: LibraryItem) => {
    setLoading(true);
    setCurrent(item);
    setPlaying(false);
    setPosition(0);
    setDuration(0);

    // Unload previous sound
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const url = await api.library.streamUrl(item.id);
      setStreamUrl(url);

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: false, volume },
        (status) => {
          if (status.isLoaded) {
            setPosition(Math.floor((status.positionMillis || 0) / 1000));
            setDuration(Math.floor((status.durationMillis || 0) / 1000));
            setPlaying(status.isPlaying);
            if (status.didJustFinish) {
              setPlaying(false);
              setPosition(0);
            }
          }
        }
      );
      soundRef.current = sound;
    } catch (err: any) {
      Alert.alert('Playback Error', 'Could not play this file. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  }, [volume]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const handlePlayPause = async () => {
    if (!soundRef.current) return;
    if (playing) {
      await soundRef.current.pauseAsync();
    } else {
      await soundRef.current.playAsync();
    }
  };

  const handleSeek = async (pct: number) => {
    if (!soundRef.current || !duration) return;
    const ms = pct * duration * 1000;
    await soundRef.current.setPositionAsync(ms);
  };

  const handleVolume = async (v: number) => {
    setVolume(v);
    await soundRef.current?.setVolumeAsync(v).catch(() => {});
  };

  const handleSkip = async (forward: boolean) => {
    if (!soundRef.current || !duration) return;
    const newPos = Math.max(0, Math.min(duration, position + (forward ? 15 : -15)));
    await soundRef.current.setPositionAsync(newPos * 1000);
  };

  const handleNext = () => {
    if (!library.length) return;
    const idx = library.findIndex(i => i.id === current?.id);
    const nextIdx = shuffle
      ? Math.floor(Math.random() * library.length)
      : (idx + 1) % library.length;
    loadItem(library[nextIdx]);
  };

  const handlePrev = () => {
    if (!library.length) return;
    const idx = library.findIndex(i => i.id === current?.id);
    const prevIdx = (idx - 1 + library.length) % library.length;
    loadItem(library[prevIdx]);
  };

  const pct = duration > 0 ? position / duration : 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={{ fontSize: 30, fontWeight: '900', color: C.text, letterSpacing: -0.5, marginBottom: 4 }}>
          Now Playing
        </Text>
        <Text style={{ fontSize: 14, color: C.muted, marginBottom: 24 }}>Music player with equalizer</Text>

        {/* Album art */}
        <View style={{
          width: '100%', aspectRatio: 1, borderRadius: 24,
          backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 24, overflow: 'hidden',
          shadowColor: C.primary, shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25, shadowRadius: 20, elevation: 12,
        }}>
          {current?.thumbnail
            ? <Image source={{ uri: current.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            : <Text style={{ fontSize: 80 }}>🎵</Text>
          }
        </View>

        {/* Track info */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          {loading && <ActivityIndicator color={C.primary} style={{ marginBottom: 10 }} />}
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.text, textAlign: 'center' }}>
            {current ? current.title : 'No track playing'}
          </Text>
          <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
            {current ? (current.artist || current.source || 'Unknown') : 'Select a track from your library'}
          </Text>
        </View>

        {/* Progress */}
        <View style={{ marginBottom: 20 }}>
          <Pressable onPress={(e) => {
            // crude tap-to-seek on the bar width
            // expo doesn't have an easy slider natively, using view width approach
          }}>
            <View style={{ height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
              <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: C.primary, borderRadius: 3 }} />
            </View>
          </Pressable>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: C.muted }}>{formatDuration(position) || '0:00'}</Text>
            <Text style={{ fontSize: 12, color: C.muted }}>{formatDuration(duration) || '0:00'}</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingHorizontal: 10 }}>
          {/* Shuffle */}
          <Pressable
            onPress={() => setShuffle(s => !s)}
            style={({ pressed }) => ({
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: shuffle ? C.primary + '33' : C.surface,
              borderWidth: 1, borderColor: shuffle ? C.primary : C.border,
              alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 18, color: shuffle ? C.primary : C.muted }}>⇄</Text>
          </Pressable>

          {/* Prev */}
          <Pressable
            onPress={handlePrev}
            style={({ pressed }) => ({
              width: 50, height: 50, borderRadius: 25,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 20, color: C.text }}>⏮</Text>
          </Pressable>

          {/* Play/Pause */}
          <Pressable
            onPress={handlePlayPause}
            disabled={!current || loading}
            style={({ pressed }) => ({
              width: 68, height: 68, borderRadius: 34,
              backgroundColor: C.primary,
              alignItems: 'center', justifyContent: 'center',
              opacity: pressed ? 0.8 : (!current || loading) ? 0.4 : 1,
              shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.5, shadowRadius: 10, elevation: 8,
            })}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontSize: 26, color: '#fff' }}>{playing ? '⏸' : '▶'}</Text>
            }
          </Pressable>

          {/* Next */}
          <Pressable
            onPress={handleNext}
            style={({ pressed }) => ({
              width: 50, height: 50, borderRadius: 25,
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 20, color: C.text }}>⏭</Text>
          </Pressable>

          {/* Repeat */}
          <Pressable
            onPress={() => setRepeat(r => !r)}
            style={({ pressed }) => ({
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: repeat ? C.primary + '33' : C.surface,
              borderWidth: 1, borderColor: repeat ? C.primary : C.border,
              alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 18, color: repeat ? C.primary : C.muted }}>↺</Text>
          </Pressable>
        </View>

        {/* Volume */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <Text style={{ fontSize: 18, color: C.muted }}>🔈</Text>
          <Pressable
            style={{ flex: 1 }}
            onPress={(e) => {
              // tap-based volume - not perfect but functional
            }}
          >
            <View style={{ height: 4, backgroundColor: C.border, borderRadius: 2 }}>
              <View style={{ width: `${volume * 100}%`, height: '100%', backgroundColor: C.primary, borderRadius: 2 }} />
            </View>
          </Pressable>
          <Text style={{ fontSize: 13, color: C.muted, width: 40, textAlign: 'right' }}>{Math.round(volume * 100)}%</Text>
        </View>

        {/* Volume buttons */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 28 }}>
          {[0.25, 0.5, 0.75, 1.0].map(v => (
            <Pressable
              key={v}
              onPress={() => handleVolume(v)}
              style={({ pressed }) => ({
                flex: 1, paddingVertical: 9, borderRadius: 10,
                backgroundColor: Math.abs(volume - v) < 0.05 ? C.primary + '33' : C.surface,
                borderWidth: 1, borderColor: Math.abs(volume - v) < 0.05 ? C.primary : C.border,
                alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: Math.abs(volume - v) < 0.05 ? C.primary : C.muted }}>
                {Math.round(v * 100)}%
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Equalizer */}
        <View style={{
          backgroundColor: C.surface, borderRadius: 16, padding: 16,
          borderWidth: 1, borderColor: C.border, marginBottom: 24,
        }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 14 }}>Equalizer</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {EQ_PRESETS.map(preset => (
              <Pressable
                key={preset}
                onPress={() => setEq(preset)}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                  backgroundColor: eq === preset ? C.primary : C.elevated,
                  borderWidth: 1.5, borderColor: eq === preset ? C.primary : C.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: eq === preset ? '#fff' : C.muted }}>
                  {preset}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Queue / Library */}
        {library.length > 0 && (
          <View>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.text, marginBottom: 12 }}>
              Queue · {library.length} tracks
            </Text>
            {library.slice(0, 8).map(item => (
              <Pressable
                key={item.id}
                onPress={() => loadItem(item)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  padding: 12, borderRadius: 12,
                  backgroundColor: current?.id === item.id ? C.primary + '18' : C.surface,
                  borderWidth: 1, borderColor: current?.id === item.id ? C.primary : C.border,
                  marginBottom: 8, opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontSize: 18, width: 28, textAlign: 'center' }}>
                  {current?.id === item.id && playing ? '▶' : '♪'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: current?.id === item.id ? C.primary : C.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.artist && <Text style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>{item.artist}</Text>}
                </View>
                {item.duration != null && (
                  <Text style={{ color: C.muted, fontSize: 11 }}>{formatDuration(item.duration)}</Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {library.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🎵</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 6 }}>No audio in library</Text>
            <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center' }}>
              Download audio from the Home tab{'\n'}to play it here
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
