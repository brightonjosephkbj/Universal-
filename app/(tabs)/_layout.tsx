import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/lib/theme';

const ICONS: Record<string, { inactive: string; active: string }> = {
  index:     { inactive: '⬇', active: '⬇' },
  library:   { inactive: '◫', active: '◫' },
  player:    { inactive: '▶', active: '▶' },
  tools:     { inactive: '⚙', active: '⚙' },
  settings:  { inactive: '☰', active: '☰' },
};

function TabIcon({ name, focused, color }: { name: string; focused: boolean; color: string }) {
  const icon = ICONS[name] || { inactive: '●', active: '●' };
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}>
      <Text style={{ fontSize: focused ? 22 : 19, color }}>{focused ? icon.active : icon.inactive}</Text>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 58 + Math.max(insets.bottom, Platform.OS === 'ios' ? 0 : 8);

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopColor: C.border,
          borderTopWidth: 0.5,
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.4,
          shadowRadius: 12,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          marginTop: 2,
          letterSpacing: 0.3,
        },
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
      })}
    >
      <Tabs.Screen name="index"    options={{ title: 'Download' }} />
      <Tabs.Screen name="library"  options={{ title: 'Library' }} />
      <Tabs.Screen name="player"   options={{ title: 'Player' }} />
      <Tabs.Screen name="tools"    options={{ title: 'Tools' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
