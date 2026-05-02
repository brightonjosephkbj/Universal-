import {
  ScrollView, Pressable, Text, View, ActivityIndicator, Alert, FlatList, Modal,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Conversion, LibraryItem, formatBytes } from '@/lib/api';
import { C } from '@/lib/theme';

const TOOLS = [
  { id: 'video-to-audio', name: 'Video → Audio', description: 'Extract audio from any video', icon: '♫', color: '#FF6B9D', outputFormats: ['MP3','AAC','FLAC','M4A','WAV'] },
  { id: 'format-convert', name: 'Format Convert', description: 'Convert between video/audio formats', icon: '⇄', color: '#00B4D8', outputFormats: ['MP4','MKV','WebM','MP3','AAC','FLAC'] },
  { id: 'trim', name: 'Trim / Clip', description: 'Cut a portion of video or audio', icon: '✂', color: '#00D9A3', outputFormats: ['MP4','MP3','MKV'] },
  { id: 'compress', name: 'Compress', description: 'Reduce file size while keeping quality', icon: '⤓', color: '#FFB020', outputFormats: ['High','Medium','Low'] },
  { id: 'merge', name: 'Merge Files', description: 'Join multiple clips into one file', icon: '⋈', color: '#7B61FF', outputFormats: ['MP4','MP3','MKV'] },
  { id: 'thumbnail', name: 'Extract Thumbnail', description: 'Save a frame from video as image', icon: '◧', color: '#FF8C42', outputFormats: ['JPG'] },
];

export default function ToolsScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(null);
  const [outputFormat, setOutputFormat] = useState('MP3');
  const [running, setRunning] = useState(false);
  const [ffmpegOk, setFfmpegOk] = useState(null);
  const [conversions, setConversions] = useState([]);
  const [library, setLibrary] = useState([]);
  const [selectedLibItem, setSelectedLibItem] = useState(null);
  const [selectedLibItems, setSelectedLibItems] = useState([]);
  const [showLibPicker, setShowLibPicker] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);

  const selectedTool = TOOLS.find(t => t.id === selected);

  const loadData = useCallback(async () => {
    try {
      const [convs, lib, check] = await Promise.all([
        api.tools.conversions.list(),
        api.library.list(),
        api.tools.check(),
      ]);
      setConversions(convs);
      setLibrary(lib);
      setFfmpegOk(check.ffmpeg);
    } catch {}
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRun = async () => {
    if (!selected || !selectedTool) return;
    if (selected === 'merge' && selectedLibItems.length < 2) {
      Alert.alert('Select Files', 'Select at least 2 files to merge.');
      setShowLibPicker(true); return;
    }
    if (selected !== 'merge' && !selectedLibItem) {
      Alert.alert('Select a File', 'Pick a file from your library first.');
      setShowLibPicker(true); return;
    }
    if (!ffmpegOk) {
      Alert.alert('ffmpeg Required', 'ffmpeg is not installed on the server.');
      return;
    }
    setRunning(true);
    try {
      const fmt = outputFormat.toLowerCase();
      if (selected === 'video-to-audio') await api.tools.videoToAudio(selectedLibItem.id, fmt);
      else if (selected === 'format-convert') await api.tools.formatConvert(selectedLibItem.id, fmt);
      else if (selected === 'trim') await api.tools.trim(selectedLibItem.id, trimStart, trimEnd, fmt);
      else if (selected === 'compress') await api.tools.compress(selectedLibItem.id, fmt);
      else if (selected === 'merge') await api.tools.merge(selectedLibItems.map(i => i.id), fmt);
      else if (selected === 'thumbnail') await api.tools.thumbnail(selectedLibItem.id, trimStart);
      Alert.alert('Started!', 'Conversion started. Check progress below.');
      loadData();
    } catch (err) {
      Alert.alert('Error', err.message || 'Conversion failed');
    } finally { setRunning(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Modal visible={showLibPicker} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: C.bg, padding: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: C.text }}>
              {selected === 'merge' ? 'Select Files to Merge' : 'Select a File'}
            </Text>
            <Pressable onPress={() => setShowLibPicker(false)}>
              <Text style={{ color: C.primary, fontSize: 16, fontWeight: '700' }}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={library}
            keyExtractor={i => i.id}
            renderItem={({ item }) => {
              const isSel = selected === 'merge'
                ? selectedLibItems.some(i => i.id === item.id)
                : selectedLibItem?.id === item.id;
              return (
                <Pressable
                  onPress={() => {
                    if (selected === 'merge') {
                      setSelectedLibItems(prev => prev.some(i => i.id === item.id) ? prev.filter(i => i.id !== item.id) : [...prev, item]);
                    } else { setSelectedLibItem(item); setShowLibPicker(false); }
                  }}
                  style={{ backgroundColor: isSel ? C.primary + '22' : C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: isSel ? C.primary : C.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <Text style={{ fontSize: 22 }}>{item.type === 'audio' ? '♫' : '▶'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ color: C.muted, fontSize: 11 }}>{item.format?.toUpperCase()} · {formatBytes(item.file_size)}</Text>
                  </View>
                  {isSel && <Text style={{ color: C.primary, fontWeight: '900', fontSize: 18 }}>✓</Text>}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>

      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom: 22 }}>
          <Text style={{ fontSize: 30, fontWeight: '900', color: C.text, letterSpacing: -0.5 }}>Tools</Text>
          <Text style={{ fontSize: 14, color: C.muted, marginTop: 3 }}>Convert and edit your media</Text>
          {ffmpegOk === false && (
            <View style={{ backgroundColor: C.error + '18', borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: C.error + '44' }}>
              <Text style={{ color: C.error, fontSize: 12, fontWeight: '700' }}>⚠ ffmpeg not found — conversions won't work</Text>
            </View>
          )}
        </View>

        {TOOLS.map(tool => (
          <Pressable key={tool.id} onPress={() => { setSelected(selected === tool.id ? null : tool.id); setOutputFormat(tool.outputFormats[0]); setSelectedLibItem(null); setSelectedLibItems([]); }}
            style={({ pressed }) => ({ backgroundColor: selected === tool.id ? tool.color + '18' : C.surface, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: selected === tool.id ? tool.color : C.border, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.8 : 1 })}>
            <View style={{ width: 50, height: 50, borderRadius: 15, backgroundColor: tool.color + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 24, color: tool.color }}>{tool.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: C.text }}>{tool.name}</Text>
              <Text style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>{tool.description}</Text>
            </View>
            <Text style={{ color: selected === tool.id ? tool.color : C.muted, fontSize: selected === tool.id ? 18 : 22, fontWeight: '800' }}>{selected === tool.id ? '✓' : '›'}</Text>
          </Pressable>
        ))}

        {selected && selectedTool && (
          <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, marginTop: 6, marginBottom: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 14 }}>{selectedTool.name} — Options</Text>

            <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>
              {selected === 'merge' ? 'Files to Merge' : 'Source File'}
            </Text>
            <Pressable onPress={() => setShowLibPicker(true)} style={{ backgroundColor: C.elevated, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 16 }}>
              <Text style={{ color: selected === 'merge' ? (selectedLibItems.length > 0 ? C.text : C.muted) : (selectedLibItem ? C.text : C.muted), fontSize: 13 }}>
                {selected === 'merge' ? (selectedLibItems.length > 0 ? `${selectedLibItems.length} files selected` : 'Tap to select files...') : (selectedLibItem ? selectedLibItem.title : 'Tap to select from Library...')}
              </Text>
            </Pressable>

            {(selected === 'trim' || selected === 'thumbnail') && (
              <>
                <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>
                  {selected === 'thumbnail' ? 'Timestamp (seconds)' : 'Time Range (seconds)'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  <View style={{ flex: 1, backgroundColor: C.elevated, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border }}>
                    <Text style={{ color: C.muted, fontSize: 10, fontWeight: '700', marginBottom: 4 }}>{selected === 'thumbnail' ? 'AT SECOND' : 'START (sec)'}</Text>
                    <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{trimStart}s</Text>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                      {[0, 5, 10, 30, 60].map(v => (
                        <Pressable key={v} onPress={() => setTrimStart(v)} style={{ backgroundColor: trimStart === v ? C.primary + '33' : C.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ color: trimStart === v ? C.primary : C.muted, fontSize: 11, fontWeight: '700' }}>{v}s</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  {selected === 'trim' && (
                    <View style={{ flex: 1, backgroundColor: C.elevated, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.border }}>
                      <Text style={{ color: C.muted, fontSize: 10, fontWeight: '700', marginBottom: 4 }}>END (sec)</Text>
                      <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{trimEnd}s</Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                        {[30, 60, 120, 300].map(v => (
                          <Pressable key={v} onPress={() => setTrimEnd(v)} style={{ backgroundColor: trimEnd === v ? C.primary + '33' : C.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                            <Text style={{ color: trimEnd === v ? C.primary : C.muted, fontSize: 11, fontWeight: '700' }}>{v}s</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              </>
            )}

            {selected !== 'thumbnail' && (
              <>
                <Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase', marginBottom: 10 }}>
                  {selected === 'compress' ? 'Quality' : 'Output Format'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                  {selectedTool.outputFormats.map(fmt => (
                    <Pressable key={fmt} onPress={() => setOutputFormat(fmt)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: outputFormat === fmt ? selectedTool.color + '22' : C.elevated, borderWidth: 1.5, borderColor: outputFormat === fmt ? selectedTool.color : C.border }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: outputFormat === fmt ? selectedTool.color : C.muted }}>{fmt}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Pressable onPress={handleRun} disabled={running} style={({ pressed }) => ({ paddingVertical: 14, borderRadius: 14, backgroundColor: selectedTool.color, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}>
              {running ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{selectedTool.icon}  Start {selectedTool.name}</Text>}
            </Pressable>
          </View>
        )}

        {conversions.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.text, marginBottom: 12 }}>Recent Conversions</Text>
            {conversions.slice(0, 5).map(c => {
              const tool = TOOLS.find(t => t.id === c.tool);
              const sc = { pending: C.muted, processing: C.primary, completed: C.success, failed: C.error }[c.status] || C.muted;
              return (
                <View key={c.id} style={{ backgroundColor: C.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 20 }}>{tool?.icon || '⚙'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{tool?.name || c.tool}</Text>
                    <Text style={{ fontSize: 11, color: C.muted }}>→ {c.output_format.toUpperCase()}{c.output_size > 0 ? `  ·  ${formatBytes(c.output_size)}` : ''}</Text>
                    {c.status === 'processing' && <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2, marginTop: 6 }}><View style={{ width: `${c.progress}%`, height: '100%', backgroundColor: C.primary, borderRadius: 2 }} /></View>}
                    {c.error_message && <Text style={{ fontSize: 11, color: C.error, marginTop: 4 }} numberOfLines={1}>⚠ {c.error_message}</Text>}
                  </View>
                  <View style={{ backgroundColor: sc + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 }}>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: sc }}>{c.status.toUpperCase()}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
