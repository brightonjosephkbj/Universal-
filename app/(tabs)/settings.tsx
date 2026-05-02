import {
  ScrollView, Pressable, Text, View, Switch,
  TextInput, Alert, Linking,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SERVER, setServerUrl, getServerUrl } from '@/lib/api';
import { C } from '@/lib/theme';

const FORMATS   = ['mp4', 'mp3', 'mkv', 'aac', 'flac', 'm4a'];
const QUALITIES = ['360p', '480p', '720p', '1080p', '1440p', '4K'];
const LOCAL_KEY = 'universal_local_settings';

async function loadSettings(): Promise<Record<string, any>> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function saveSettings(updates: Record<string, any>) {
  try {
    const current = await loadSettings();
    await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify({ ...current, ...updates }));
  } catch {}
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, marginBottom: 10, marginLeft: 4 }}>
        {label}
      </Text>
      <View style={{ backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
        {children}
      </View>
    </View>
  );
}

function Row({ label, sub, right, borderBottom = true }: {
  label: string; sub?: string; right: React.ReactNode; borderBottom?: boolean;
}) {
  return (
    <View style={{
      paddingHorizontal: 16, paddingVertical: 14,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderBottomWidth: borderBottom ? 0.5 : 0, borderBottomColor: C.border,
    }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }}>{label}</Text>
        {sub && <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{sub}</Text>}
      </View>
      {right}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
        marginRight: 6, marginBottom: 6,
        backgroundColor: active ? C.primary + '22' : C.elevated,
        borderWidth: 1.5, borderColor: active ? C.primary : C.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: active ? C.primary : C.muted }}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [defaultFormat, setDefaultFormat]   = useState('mp4');
  const [defaultQuality, setDefaultQuality] = useState('720p');
  const [notifications, setNotifications]   = useState(true);
  const [autoLibrary, setAutoLibrary]       = useState(true);
  const [serverUrl, setServerUrlState]      = useState(DEFAULT_SERVER);
  const [editingServer, setEditingServer]   = useState(false);
  const [serverInput, setServerInput]       = useState('');

  useEffect(() => {
    loadSettings().then(s => {
      if (s.defaultFormat)  setDefaultFormat(s.defaultFormat);
      if (s.defaultQuality) setDefaultQuality(s.defaultQuality);
      if (s.notifications !== undefined) setNotifications(s.notifications);
      if (s.autoLibrary !== undefined) setAutoLibrary(s.autoLibrary);
    });
    getServerUrl().then(url => { setServerUrlState(url); setServerInput(url); });
  }, []);

  const handleSaveServer = async () => {
    const url = serverInput.trim().replace(/\/$/, '');
    if (!url.startsWith('http')) {
      Alert.alert('Invalid URL', 'Server URL must start with http:// or https://');
      return;
    }
    await setServerUrl(url);
    setServerUrlState(url);
    setEditingServer(false);
    Alert.alert('Saved', 'Server URL updated. Restart the app if needed.');
  };

  const handleClearSettings = () => {
    Alert.alert('Clear Settings', 'Reset all preferences to defaults?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive', onPress: async () => {
          await AsyncStorage.removeItem(LOCAL_KEY);
          setDefaultFormat('mp4'); setDefaultQuality('720p');
          setNotifications(true); setAutoLibrary(true);
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 50 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ marginBottom: 28 }}>
          <Text style={{ fontSize: 30, fontWeight: '900', color: C.text, letterSpacing: -0.5 }}>Settings</Text>
          <Text style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>Customize your experience</Text>
        </View>

        {/* Download Defaults */}
        <Section label="Download Defaults">
          <View style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: C.border }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
              Default Format
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {FORMATS.map(f => (
                <Chip key={f} label={f} active={defaultFormat === f}
                  onPress={() => { setDefaultFormat(f); saveSettings({ defaultFormat: f }); }} />
              ))}
            </View>
          </View>
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
              Default Quality
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {QUALITIES.map(q => (
                <Chip key={q} label={q} active={defaultQuality === q}
                  onPress={() => { setDefaultQuality(q); saveSettings({ defaultQuality: q }); }} />
              ))}
            </View>
          </View>
        </Section>

        {/* App */}
        <Section label="App">
          <Row
            label="Download Notifications"
            sub="Alert when a download completes"
            right={
              <Switch
                value={notifications}
                onValueChange={v => { setNotifications(v); saveSettings({ notifications: v }); }}
                trackColor={{ false: C.border, true: C.primary }}
                thumbColor="#fff"
              />
            }
          />
          <Row
            label="Auto-add to Library"
            sub="Save completed downloads automatically"
            borderBottom={false}
            right={
              <Switch
                value={autoLibrary}
                onValueChange={v => { setAutoLibrary(v); saveSettings({ autoLibrary: v }); }}
                trackColor={{ false: C.border, true: C.primary }}
                thumbColor="#fff"
              />
            }
          />
        </Section>

        {/* Server */}
        <Section label="Server">
          <View style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: C.border }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
              Backend URL
            </Text>
            {editingServer ? (
              <>
                <TextInput
                  value={serverInput}
                  onChangeText={setServerInput}
                  autoCapitalize="none" autoCorrect={false} keyboardType="url"
                  style={{
                    backgroundColor: C.elevated, color: C.text, fontSize: 13,
                    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
                    borderWidth: 1.5, borderColor: C.primary, marginBottom: 10,
                  }}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={() => { setEditingServer(false); setServerInput(serverUrl); }}
                    style={({ pressed }) => ({
                      flex: 1, paddingVertical: 10, borderRadius: 10,
                      backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border,
                      alignItems: 'center', opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: C.muted, fontWeight: '700' }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSaveServer}
                    style={({ pressed }) => ({
                      flex: 2, paddingVertical: 10, borderRadius: 10,
                      backgroundColor: C.primary, alignItems: 'center', opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Save URL</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable onPress={() => setEditingServer(true)}>
                <Text style={{ fontSize: 13, color: C.primary, fontWeight: '600' }}>{serverUrl}</Text>
                <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Tap to change</Text>
              </Pressable>
            )}
          </View>
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 13, color: C.muted, lineHeight: 19 }}>
              Deploy the server free on{' '}
              <Text
                style={{ color: C.primary, fontWeight: '700' }}
                onPress={() => Linking.openURL('https://render.com')}
              >
                Render.com
              </Text>
              . See the README for setup instructions.
            </Text>
          </View>
        </Section>

        {/* Danger */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: C.error, marginBottom: 10, marginLeft: 4 }}>
            Danger Zone
          </Text>
          <View style={{ backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
            <Row
              label="Clear Local Settings"
              sub="Reset all preferences to defaults"
              borderBottom={false}
              right={
                <Pressable
                  onPress={handleClearSettings}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                    backgroundColor: C.error + '18', borderWidth: 1, borderColor: C.error + '44',
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.error }}>Clear</Text>
                </Pressable>
              }
            />
          </View>
        </View>

        {/* About */}
        <Section label="About">
          <Row label="Version"    right={<Text style={{ color: C.muted, fontSize: 14 }}>2.0.0</Text>} />
          <Row label="Engine"     sub="yt-dlp + Node.js + SQLite" right={<Text style={{ color: C.muted }}>◎</Text>} />
          <Row
            label="Source Code"
            borderBottom={false}
            right={
              <Pressable onPress={() => Linking.openURL('https://github.com/brightonjosephkbj/Universal')}>
                <Text style={{ color: C.primary, fontSize: 13, fontWeight: '700' }}>GitHub ↗</Text>
              </Pressable>
            }
          />
        </Section>

        <Text style={{ textAlign: 'center', color: C.muted, fontSize: 12, marginTop: 16, lineHeight: 20 }}>
          Universal Downloader v2.0{'\n'}
          Built for Android · Powered by yt-dlp
        </Text>
      </ScrollView>
    </View>
  );
}
