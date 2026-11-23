import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import {
  NavigationContainer,
  TabRouter,
  createNavigationContainerRef,
  createNavigatorFactory,
  useNavigationBuilder,
} from '@react-navigation/native';
import { Lyrelog, LyrelogErrorBoundary, trackNavigation } from '@lyrelog/react-native';

// Driftwood: a made-up beachcombing log. Log what washed up, sync the tide table (it fails),
// break a card, crash on purpose, choose whether to share diagnostics.

const finds = Lyrelog.logger('finds');
const navigationRef = createNavigationContainerRef();

declare const ErrorUtils: { reportError(error: unknown): void };

function Button({ title, onPress, tone }: { title: string; onPress: () => void; tone?: 'danger' }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.button, tone === 'danger' && styles.danger]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

function Shore() {
  const [count, setCount] = React.useState(0);
  const [crash, setCrash] = React.useState(false);
  if (crash) throw new Error('The tide ate the screen');
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Shore</Text>
      <Text style={styles.body}>{count} finds today</Text>
      <Button
        title="Log a find"
        onPress={() => {
          setCount(count + 1);
          finds.info('find_logged', { attrs: { kind: 'sea_glass', colour: 'green', count: count + 1 } });
        }}
      />
      <Button
        title="Sync the tide table"
        onPress={async () => {
          try {
            throw Object.assign(new Error('tide service answered 503'), { status: 503 });
          } catch (error) {
            Lyrelog.captureError(error, { category: 'sync', attrs: { station: 'cadiz' } });
          }
        }}
      />
      <Button title="Report a JS error (not fatal)" onPress={() => ErrorUtils.reportError(new Error('Bucket handle snapped'))} />
      <Button
        title="Leave a promise unhandled"
        onPress={() => {
          Promise.reject(new Error('Shell catalogue fetch failed'));
        }}
      />
      <Button title="Crash in render (fatal)" tone="danger" onPress={() => setCrash(true)} />
      <Button
        title="Throw in a timer"
        tone="danger"
        onPress={() =>
          setTimeout(() => {
            throw new TypeError('Driftwood is not a function');
          }, 0)
        }
      />
    </ScrollView>
  );
}

function BrokenCard(): React.ReactElement {
  throw new Error('This card has barnacles');
}

function Finds() {
  const [broken, setBroken] = React.useState(false);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Finds</Text>
      <LyrelogErrorBoundary
        category="finds"
        fallback={({ reset }) => (
          <Button
            title="The card broke. Try again"
            onPress={() => {
              setBroken(false);
              reset();
            }}
          />
        )}>
        {broken ? <BrokenCard /> : <Text style={styles.body}>Green sea glass, a cuttlebone, a rope knot.</Text>}
      </LyrelogErrorBoundary>
      <Button title="Break a card" onPress={() => setBroken(true)} />
    </View>
  );
}

function Settings() {
  const [share, setShare] = React.useState(true);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.row}>
        <Text style={styles.body}>Share diagnostics</Text>
        <Switch
          value={share}
          onValueChange={(value) => {
            setShare(value);
            Lyrelog.setConsent(value ? 'granted' : 'denied');
          }}
        />
      </View>
      <Button title="Send now" onPress={() => Lyrelog.flush()} />
      <Text style={styles.small}>Session {Lyrelog.sessionId ?? 'not started'}</Text>
    </View>
  );
}

// A three-tab navigator in a few lines, so the example needs no native navigation library.
function TabsNavigator(props: { id?: string; initialRouteName?: string; children: React.ReactNode }) {
  const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, props);
  return (
    <NavigationContent>
      <View style={styles.app}>
        <View style={styles.content}>{descriptors[state.routes[state.index].key].render()}</View>
        <View style={styles.tabs}>
          {state.routes.map((route, index) => (
            <Pressable key={route.key} onPress={() => navigation.navigate(route.name)} style={styles.tab}>
              <Text style={[styles.tabText, index === state.index && styles.tabActive]}>{route.name}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </NavigationContent>
  );
}

const Tab = createNavigatorFactory(TabsNavigator)();

export default function App() {
  React.useEffect(() => {
    Lyrelog.setUser('beachcomber-7');
  }, []);
  return (
    <NavigationContainer ref={navigationRef} {...trackNavigation(navigationRef)}>
      <Tab.Navigator>
        <Tab.Screen name="Shore" component={Shore} />
        <Tab.Screen name="Finds" component={Finds} />
        <Tab.Screen name="Settings" component={Settings} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f6f4ef' },
  content: { flex: 1, paddingTop: 64 },
  screen: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '600', color: '#1d2a33' },
  body: { fontSize: 16, color: '#1d2a33' },
  small: { fontSize: 14, color: '#5b6770' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: { backgroundColor: '#2747d6', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16 },
  danger: { backgroundColor: '#b3261e' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#c9c4b8', paddingBottom: 28 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { fontSize: 16, color: '#5b6770' },
  tabActive: { color: '#2747d6', fontWeight: '600' },
});
