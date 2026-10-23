import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Linking, StatusBar, ToastAndroid, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import QueueScreen from './src/screens/QueueScreen';
import ApplyScreen from './src/screens/ApplyScreen';
import AssistSheet from './src/screens/AssistSheet';
import SettingsScreen from './src/screens/SettingsScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ShellTabs from './src/screens/ShellTabs';
import GmailScreen from './src/screens/GmailScreen';
import HuntLayer from './src/screens/HuntLayer';
import { colors } from './src/theme';
import { createBrowserBridge } from './src/magnet/browser';
import { getMagnet, setBrowser, setHuntBrowser, setHuntHandlers } from './src/magnet/client';
import { hydrateStore, persistStore, bundlePathHint, bytesFromUri } from './src/magnet/store';
import { mailShortcut, oauthCallbackParams, nextAutofillJob, asQueueN } from '../packages/core/src/rn';
import { playChime, chatSoundOn } from './src/magnet/chime';
const chatTabs = require('../lib/chat-tabs');

function toast(msg) {
  try {
    ToastAndroid.show(String(msg), ToastAndroid.SHORT);
  } catch {
    Alert.alert(String(msg));
  }
}

function looksLikeUrl(text) {
  const t = String(text || '').trim();
  return /^https?:\/\//i.test(t) || t.startsWith('magnet://');
}

function pingSound(magnet, webRef) {
  const snap = magnet.getSettings();
  if (!chatSoundOn(snap && snap.settings)) return;
  playChime(webRef && webRef.current);
}

function canTogglePosting(job) {
  const bucket = job && (job.bucket || job.status);
  return bucket === 'submitted' || bucket === 'passed';
}

export default function App() {
  const magnet = useMemo(() => getMagnet(), []);
  const bridge = useMemo(() => createBrowserBridge(), []);
  const huntBridge = useMemo(() => createBrowserBridge(), []);
  const webRef = useRef(null);
  const huntLoginResolve = useRef(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const [pane, setPane] = useState('jobs');
  const [applySurface, setApplySurface] = useState('web');
  const [railTab, setRailTab] = useState('chat');
  const [chatKey, setChatKey] = useState(chatTabs.INGEST_KEY);
  const [seeAllChats, setSeeAllChats] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [gmailPhase, setGmailPhase] = useState('idle');
  const [gmailIntent, setGmailIntent] = useState(null);
  const [gmailHref, setGmailHref] = useState(null);
  const [huntUrl, setHuntUrl] = useState('about:blank');
  const [huntLoginOpen, setHuntLoginOpen] = useState(false);
  const [huntLoginPrompt, setHuntLoginPrompt] = useState('');
  const gmailBackRef = useRef(null);
  const [ingestPlan, setIngestPlan] = useState(null);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [autofillStep, setAutofillStep] = useState('');
  const queueLeftRef = useRef(0);
  const [splitOpen, setSplitOpen] = useState(false);
  const [filter, setFilter] = useState({ status: 'open', q: '', yoe: 'all', level: 'all' });
  const [listed, setListed] = useState({ jobs: [], totals: {} });
  const [job, setJob] = useState(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [nav, setNav] = useState({ url: '', canGoBack: false, canGoForward: false });
  const [chat, setChat] = useState([]);
  const [ingestLog, setIngestLog] = useState([]);
  const [leftovers, setLeftovers] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(null);
  const [record, setRecord] = useState(null);
  const [tick, setTick] = useState(0);
  const [notices, setNotices] = useState([]);

  const refresh = useCallback(() => {
    const out = magnet.listJobs(filter);
    setListed(out);
    setIngestLog(magnet.getChat({ id: '__ingest__' }).messages);
    if (chatKey === chatTabs.INGEST_KEY) {
      setChat(magnet.getChat({ id: '__ingest__' }).messages);
    } else if (chatKey) {
      setChat(magnet.getChat({ id: chatKey }).messages);
    } else if (job) {
      setChat(magnet.getChat({ id: job.id }).messages);
    }
    const inbox = magnet.listNotices();
    setNotices((inbox && inbox.notices) || []);
    if (job) setRecord(magnet.getProcess({ id: job.id }).record);
    setTick((n) => n + 1);
  }, [magnet, filter, job, chatKey]);

  function finishHuntLogin(result) {
    const resolve = huntLoginResolve.current;
    huntLoginResolve.current = null;
    setHuntLoginOpen(false);
    if (resolve) resolve(result);
  }

  useEffect(() => {
    hydrateStore()
      .then(() => refresh())
      .catch(() => refresh());
    setBrowser(bridge);
    setHuntBrowser(huntBridge);
  }, [bridge, huntBridge, refresh]);

  useEffect(() => {
    setHuntHandlers({
      onOpen: async (url) => {
        setHuntUrl(url);
      },
      onLogin: (wall) =>
        new Promise((resolve) => {
          huntLoginResolve.current = resolve;
          setHuntLoginPrompt(
            `${(wall && wall.site) || 'This site'} needs a sign-in. Cookies stay on this phone — never paste a password in chat.`
          );
          setHuntLoginOpen(true);
        }),
      onProgress: (_text, messages) => {
        if (messages) setIngestLog(messages);
        refresh();
      },
    });
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [filter, refresh]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (huntLoginOpen) {
        finishHuntLogin({ skipped: true });
        return true;
      }
      if (gmailOpen) {
        if (gmailBackRef.current) return gmailBackRef.current();
        setGmailOpen(false);
        setGmailPhase('idle');
        return true;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (splitOpen) {
        setSplitOpen(false);
        return true;
      }
      if (pane === 'chat') {
        setPane(job ? 'apply' : 'jobs');
        return true;
      }
      if (pane === 'apply') {
        if (nav.canGoBack && webRef.current) {
          webRef.current.goBack();
          return true;
        }
        if (canTogglePosting(job)) {
          setApplySurface('dash');
          return true;
        }
        setPane('jobs');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [gmailOpen, settingsOpen, splitOpen, pane, applySurface, job, nav.canGoBack, huntLoginOpen]);

  function syncJob(next) {
    setJob(next);
    setUrlDraft(next && next.url ? next.url : '');
    setRecord(next ? magnet.getProcess({ id: next.id }).record : null);
    setLeftovers(next ? (magnet.getProcess({ id: next.id }).record.review || []) : []);
    setStatus('');
    setSplitOpen(false);
  }

  function findListedJob(key) {
    const jobs = magnet.listJobs({ status: 'all' }).jobs || [];
    return jobs.find((j) => j.id === key || j.url === key) || null;
  }

  function selectConversation(key, opts = {}) {
    const nextKey = key || chatTabs.INGEST_KEY;
    const out = magnet.selectChat({ key: nextKey, pageSubtab: opts.pageSubtab });
    setChatKey(nextKey);
    setSeeAllChats(false);
    if (nextKey === chatTabs.INGEST_KEY) {
      setChat(magnet.getChat({ id: '__ingest__' }).messages);
      setPane('chat');
      return;
    }
    const listedJob = findListedJob(nextKey);
    const id = listedJob ? listedJob.id : nextKey;
    setChat(magnet.getChat({ id }).messages);
    if (out && out.pageSubtab) setRailTab(out.pageSubtab === 'debug' ? 'review' : out.pageSubtab);
    else if (opts.pageSubtab) setRailTab(opts.pageSubtab === 'debug' ? 'review' : opts.pageSubtab);
    if (listedJob && (listedJob.bucket === 'open' || listedJob.status === 'open') && !opts.conversationOnly) {
      syncJob(listedJob);
    }
    setPane('chat');
  }

  function openJob(next, opts = {}) {
    syncJob(next);
    magnet.ensureChatTab({ key: next.id });
    setApplySurface(canTogglePosting(next) ? 'dash' : 'web');
    setPane('apply');
    if (opts.autofill) runAutofill('all', next);
    else if (!opts.skipAutofill && magnet.getSettings().settings && magnet.getSettings().settings.autofillOnOpen) {
      runAutofill('all', next);
    }
  }

  function pickNextOpen(afterId) {
    const all = magnet.listJobs({ status: 'all' }).jobs || [];
    const idx = all.findIndex((j) => j.id === afterId);
    const start = idx >= 0 ? idx + 1 : 0;
    for (let n = 0; n < all.length; n += 1) {
      const row = all[(start + n) % all.length];
      if (!row || row.id === afterId) continue;
      if (row.bucket === 'open') return row;
    }
    return null;
  }

  function afterClose(closedId) {
    persistStore();
    refresh();
    const next = pickNextOpen(closedId);
    if (next) {
      openJob(next);
      return;
    }
    const updated = (magnet.listJobs({ status: 'all' }).jobs || []).find((j) => j.id === closedId);
    if (updated) {
      syncJob(updated);
      setApplySurface('dash');
      setPane('apply');
    } else {
      setJob(null);
      setPane('jobs');
    }
  }

  async function passJob(next) {
    await magnet.passJob({ id: next.id, url: next.url });
    toast('Passed');
    if (job && job.id === next.id) afterClose(next.id);
    else {
      persistStore();
      refresh();
    }
  }

  async function runAutofill(stage, targetJob, opts = {}) {
    const current = targetJob || job;
    if (!current) return;
    if (!opts.chain) {
      queueLeftRef.current = asQueueN(magnet.getSettings().settings && magnet.getSettings().settings.autofillQueueN);
    }
    setBusy(true);
    setStatus('Autofill…');
    setAutofillStep('JD');
    setPane('apply');
    setApplySurface('web');
    let chained = false;
    try {
      if (webRef.current) {
        bridge.setWebView(webRef.current);
        bridge.injectBridge();
      }
      const out = await magnet.runAutofill({
        id: current.id,
        stage: stage || 'all',
        chain: Boolean(opts.chain),
        onStep: (id) => setAutofillStep(id),
      });
      setLeftovers(out.leftovers || []);
      setStatus(
        out.cancelled
          ? 'Cancelled'
          : out.skipped
            ? 'Skipped'
            : `Filled ${((out.filled || []).length)} · ${((out.leftovers || []).length)} leftover`
      );
      if ((out.leftovers || []).length) {
        magnet.selectChat({ key: current.id, pageSubtab: 'debug' });
        setChatKey(current.id);
        setRailTab('review');
        setPane('chat');
      } else if (stage === 'essay' || stage === 'essays') {
        magnet.selectChat({ key: current.id, pageSubtab: 'chat' });
        setChatKey(current.id);
        setRailTab('chat');
        setPane('chat');
      }
      if (out.attached && out.attached.detail) toast(out.attached.detail);
      if (!out.cancelled) pingSound(magnet, webRef);
      if (!out.cancelled && (stage || 'all') === 'all' && queueLeftRef.current > 0) {
        const next = nextAutofillJob(magnet.listJobs({ status: 'open' }).jobs, {
          afterId: current.id,
          getProcess: (url) => magnet.getProcess({ url }).record,
        });
        if (next) {
          chained = true;
          queueLeftRef.current -= 1;
          openJob(next, { skipAutofill: true });
          await runAutofill('all', next, { chain: true });
          return;
        }
      }
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      if (!chained) {
        setBusy(false);
        setAutofillStep('');
        refresh();
      }
    }
  }

  function onWebMessage(raw) {
    const msg = bridge.handleMessage(raw);
    if (!msg) return;
    if (msg.type === 'field-longpress' || msg.type === 'field-focus') {
      setTarget(msg.payload);
            if (msg.type === 'field-longpress') {
              if (job) selectConversation(job.id, { pageSubtab: 'chat' });
              else {
                setRailTab('chat');
                setPane('chat');
              }
            }
    }
  }

  async function goUrl() {
    const text = String(urlDraft || '').trim();
    if (!text) return;
    if (!looksLikeUrl(text)) {
      setFilter((f) => ({ ...f, q: text, status: 'all' }));
      return;
    }
    const existing = (listed.jobs || []).find((j) => j.url === text);
    if (existing) {
      openJob(existing, { skipAutofill: true });
      return;
    }
    const out = await magnet.ingest({ text });
    refresh();
    const created = (out.added && out.added[0]) || (out.jobs || []).find((j) => j.url === text);
    if (created) openJob(created, { skipAutofill: true });
    else {
      setPane('apply');
      toast(`Added ${(out.added || []).length}`);
    }
  }

  async function importResume() {
    try {
      const picker = require('expo-document-picker');
      const picked = await picker.getDocumentAsync({ type: ['application/pdf', 'application/msword'] });
      if (picked.canceled) return;
      const file = picked.assets && picked.assets[0];
      if (!file) return;
      const bytes = await bytesFromUri(file.uri);
      magnet.importResume({
        id: (file.name || 'resume').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        label: file.name || 'Resume',
        filename: file.name || 'resume.pdf',
        abs: file.uri,
        bytes,
        mime: file.mimeType,
        isDefault: magnet.listResumes().resumes.length === 0,
      });
      toast('Stored in vault');
      refresh();
    } catch (err) {
      toast(err.message || 'Picker unavailable');
    }
  }

  function openGmail(intent, href) {
    setGmailIntent(intent || null);
    setGmailHref(href || null);
    setGmailPhase(href ? 'webview' : 'idle');
    setGmailOpen(true);
  }

  function handleMailShortcut(out) {
    if (!out) return false;
    if (out.needMailConnect) {
      openGmail('signin');
      return true;
    }
    if (out.needMailScan) {
      openGmail('scan');
      return true;
    }
    return false;
  }

  useEffect(() => {
    function onUrl({ url }) {
      if (oauthCallbackParams(url)) openGmail('signin');
    }
    const sub = Linking.addEventListener('url', onUrl);
    Linking.getInitialURL().then((url) => {
      if (url && oauthCallbackParams(url)) openGmail('signin');
    });
    return () => sub && sub.remove();
  }, []);

  const settingsSnap = magnet.getSettings();
  const mailSnap = magnet.mailStatus();
  const resumes = magnet.listResumes().resumes;
  const voice = magnet.getVoice().voice;
  const systemPrompt = magnet.getSystemPrompt().systemPrompt;

  const conversationItems = useMemo(() => {
    const ui = magnet.getChatUi();
    const jobs = listed.jobs || [];
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const byUrl = new Map(jobs.map((j) => [j.url, j]));
    return (ui.mru || [])
      .map((key) => {
        const row = byId.get(key) || byUrl.get(key);
        return {
          key,
          kind: 'job',
          label: chatTabs.chatTabLabel((row && (row.company || row.name || row.title)) || key),
          company: row && (row.company || row.name),
          title: row && row.title,
          jobId: row && row.id,
        };
      })
      .filter(Boolean);
  }, [magnet, listed.jobs, tick]);

  const chatJob = findListedJob(chatKey);
  const chatRecord =
    chatJob && chatJob.id === (job && job.id)
      ? record
      : chatJob
        ? magnet.getProcess({ id: chatJob.id }).record
        : record;
  const canOpenChatJob = Boolean(chatJob && (!job || job.id !== chatJob.id || applySurface !== 'web'));

  const padTop = StatusBar.currentHeight || 0;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg, paddingTop: padTop }}>
      <ExpoStatusBar style="light" />
      <View style={{ flex: 1 }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: pane === 'jobs' ? 2 : 0,
            opacity: pane === 'jobs' ? 1 : 0,
            pointerEvents: pane === 'jobs' ? 'auto' : 'none',
          }}
        >
          <QueueScreen
            jobs={listed.jobs}
            totals={listed.totals}
            filter={filter}
            onFilter={setFilter}
            onOpen={(row) => openJob(row)}
            onPass={passJob}
            onAutofill={(row) => openJob(row, { autofill: true })}
            onIngest={() => selectConversation(chatTabs.INGEST_KEY)}
            onSettings={() => setSettingsOpen(true)}
            mail={settingsSnap.mail}
            onMail={() => openGmail()}
            notices={notices}
            onNotice={async (n) => {
              if (n && n.mailId) await magnet.markNoticeRead({ mailId: n.mailId, key: n.key });
              refresh();
              if (n && n.jobId) {
                const listedJob = (magnet.listJobs({ status: 'all' }).jobs || []).find((j) => j.id === n.jobId);
                if (listedJob) {
                  openJob(listedJob, { skipAutofill: true });
                  selectConversation(listedJob.id, { pageSubtab: 'chat' });
                  return;
                }
              }
              if (n && n.href) openGmail(null, n.href);
            }}
            url={urlDraft}
            onUrlChange={setUrlDraft}
            onUrlSubmit={goUrl}
            canBack={nav.canGoBack}
            canForward={nav.canGoForward}
            onBack={() => webRef.current && webRef.current.goBack()}
            onForward={() => webRef.current && webRef.current.goForward()}
            onReload={() => webRef.current && webRef.current.reload()}
            activeId={job && job.id}
          />
        </View>

        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: pane === 'apply' ? 2 : 0,
            opacity: pane === 'apply' ? 1 : 0,
            pointerEvents: pane === 'apply' ? 'auto' : 'none',
          }}
        >
          <ApplyScreen
            job={job}
            uiLanguage={(settingsSnap.settings && settingsSnap.settings.uiLanguage) || 'en-US'}
            webRef={(r) => {
              webRef.current = r;
              bridge.setWebView(r);
            }}
            onMessage={onWebMessage}
            onNav={(state) => {
              setNav({
                url: state.url || '',
                canGoBack: Boolean(state.canGoBack),
                canGoForward: Boolean(state.canGoForward),
              });
              if (state.url && !String(state.url).startsWith('about:')) setUrlDraft(state.url);
            }}
            onAutofill={() => {
              if (busy) magnet.cancelFill();
              else runAutofill('all');
            }}
            onStage={(stage) => {
              setSplitOpen(false);
              runAutofill(stage);
            }}
            onComplete={async () => {
              if (!job) return;
              if ((leftovers || []).length && settingsSnap.settings && settingsSnap.settings.reviewGate !== false) {
                if (job) selectConversation(job.id, { pageSubtab: 'review' });
                else {
                  setRailTab('review');
                  setPane('chat');
                }
                toast('Review leftover fields first');
                return;
              }
              const out = await magnet.completeJob({ id: job.id, url: job.url });
              toast(out.undo ? 'Submitted · say undo to revert' : 'Submitted');
              if (out.debrief && !out.debrief.empty) {
                selectConversation(job.id, { pageSubtab: 'chat' });
                setChat(out.messages || magnet.getChat({ id: job.id }).messages);
                setPane('chat');
                setRailTab('chat');
              } else {
                afterClose(job.id);
              }
            }}
            onPass={() => job && passJob(job)}
            onToggleSurface={() => setApplySurface((s) => (s === 'dash' ? 'web' : 'dash'))}
            onResume={() => setSettingsOpen(true)}
            surface={applySurface}
            dashboard={
              job ? (
                <DashboardScreen
                  job={job}
                  record={record || magnet.getProcess({ id: job.id }).record}
                  onNote={(prep_notes) => {
                    magnet.writeProcess({ id: job.id, patch: { prep_notes } });
                    refresh();
                  }}
                  onEvent={(event) => {
                    magnet.appendProcessEvent({ id: job.id, event });
                    refresh();
                  }}
                  onContact={(contact) => {
                    magnet.addProcessContact({ id: job.id, contact });
                    refresh();
                  }}
                  mail={settingsSnap.mail}
                  queue={mailSnap.queue}
                  onGmail={() => openGmail()}
                  onScanMail={() => openGmail('scan')}
                  onResolveMail={(id, action, url) => {
                    magnet.mailResolve({ id, action, url });
                    refresh();
                  }}
                />
              ) : null
            }
            status={status}
            busy={busy}
            resumeLabel={resumes[0] && resumes[0].label}
            stepCurrent={autofillStep}
            splitOpen={splitOpen}
            onSplit={() => setSplitOpen((v) => !v)}
          />
        </View>

        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: pane === 'chat' ? 2 : 0,
            opacity: pane === 'chat' ? 1 : 0,
            pointerEvents: pane === 'chat' ? 'auto' : 'none',
          }}
        >
          <AssistSheet
            tab={railTab === 'ingest' ? 'chat' : railTab}
            onTab={(next) => {
              setRailTab(next);
              if (chatKey && chatKey !== chatTabs.INGEST_KEY) {
                magnet.selectChat({
                  key: chatKey,
                  pageSubtab: next === 'review' ? 'debug' : next,
                });
              }
            }}
            chat={chatKey === chatTabs.INGEST_KEY ? ingestLog : chat}
            leftovers={leftovers}
            modelId={(settingsSnap.settings && settingsSnap.settings.modelId) || ''}
            models={(settingsSnap.settings && settingsSnap.settings.customModels) || ['grok-4.6', 'gpt-4.1-mini', 'composer-2']}
            onModel={(id) => {
              magnet.setSettings({ modelId: id });
              refresh();
            }}
            onRewrite={async (row) => {
              const jobId = (chatJob && chatJob.id) || (job && job.id);
              if (!jobId) return;
              const out = await magnet.sendChat({
                id: jobId,
                text: `Rewrite this leftover field: ${row.label || row.id}`,
                fieldIds: [row.id],
              });
              setChat(out.messages);
              setRailTab('chat');
            }}
            onLearn={(row) => {
              magnet.learnRecipe({
                recipe: { id: `r-${row.id}`, label_key: row.label, value: row.intended },
              });
              toast('Recipe saved');
            }}
            onPasteJd={async () => {
              const targetJob = chatJob || job;
              if (!targetJob) return;
              try {
                let text = '';
                try {
                  const Clip = require('expo-clipboard');
                  text = Clip.getStringAsync ? await Clip.getStringAsync() : '';
                } catch {
                  const { Clipboard } = require('react-native');
                  text = Clipboard && Clipboard.getString ? await Clipboard.getString() : '';
                }
                if (text) {
                  magnet.writeProcess({ id: targetJob.id, patch: { jd: { text, source: 'clipboard' } } });
                  toast('JD pasted');
                  refresh();
                }
              } catch (err) {
                toast(err.message || 'Paste failed');
              }
            }}
            jdText={chatRecord && chatRecord.jd && (chatRecord.jd.text || JSON.stringify(chatRecord.jd))}
            target={chatJob && job && chatJob.id === job.id ? target : null}
            onClearTarget={() => setTarget(null)}
            conversationKey={chatKey}
            onSelectConversation={(key) => selectConversation(key)}
            conversationItems={conversationItems}
            handedness={(settingsSnap.settings && settingsSnap.settings.handedness) || 'right'}
            seeAll={seeAllChats}
            onSeeAll={setSeeAllChats}
            ingestBusy={ingestBusy}
            ingestPlan={ingestPlan}
            canOpenJob={canOpenChatJob}
            openLabel={chatJob ? `Open ${chatTabs.chatTabLabel(chatJob.company || chatJob.name || chatJob.title)}` : 'Open'}
            onOpenJob={() => chatJob && openJob(chatJob, { skipAutofill: true })}
            onApprove={async (schema) => {
              setIngestBusy(true);
              try {
                const out = await magnet.approveSearch({ schema });
                setIngestLog(out.messages);
                setChat(out.messages);
                setIngestPlan(out.needBoards ? out.schema || schema : null);
                refresh();
                pingSound(magnet, webRef);
                toast(out.needBoards ? 'Need ATS URLs or a signed-in hunt' : `Added ${(out.added || []).length}`);
              } catch (err) {
                toast(err.message || String(err));
              } finally {
                setIngestBusy(false);
              }
            }}
            onAnswer={async (asks, answers) => {
              const text = Object.values(answers || {}).filter(Boolean).join('\n');
              if (!text) return;
              setIngestBusy(true);
              try {
                if (chatKey === chatTabs.INGEST_KEY || !chatJob) {
                  const out = await magnet.ingest({ text });
                  setIngestLog(out.messages);
                  setChat(out.messages);
                } else {
                  const out = await magnet.sendChat({ id: chatJob.id, text });
                  setChat(out.messages);
                }
              } finally {
                setIngestBusy(false);
              }
            }}
            onSend={async (text) => {
              if (/^undo$/i.test(String(text || '').trim())) {
                const out = await magnet.undoOutcome();
                toast(out.ok ? 'Undid last complete or pass' : out.error || 'Nothing to undo');
                refresh();
                return;
              }
              const shortcut = mailShortcut(text);
              if (handleMailShortcut(shortcut)) return;
              if (chatKey === chatTabs.INGEST_KEY || !chatJob) {
                setIngestBusy(true);
                try {
                  const out = await magnet.ingest({ text });
                  setIngestLog(out.messages);
                  setChat(out.messages);
                  setIngestPlan(out.schema || null);
                  magnet.selectChat({ key: chatTabs.INGEST_KEY });
                  setChatKey(chatTabs.INGEST_KEY);
                  refresh();
                  pingSound(magnet, webRef);
                  if (handleMailShortcut(out)) return;
                  if (out.needBoards) toast('Need a Greenhouse / Ashby / Lever URL first');
                  else if (out.added && out.added.length) toast(`Added ${out.added.length}`);
                } catch (err) {
                  toast(err.message || String(err));
                } finally {
                  setIngestBusy(false);
                }
                return;
              }
              const out = await magnet.sendChat({
                id: chatJob.id,
                text,
                fieldIds: target && job && chatJob.id === job.id && target.id ? [target.id] : [],
              });
              setChat(out.messages);
              pingSound(magnet, webRef);
            }}
            onAccept={async (row) => {
              await magnet.acceptReview({ id: (chatJob && chatJob.id) || (job && job.id), fieldId: row.id, value: row.intended, label: row.label });
              setLeftovers((rows) => rows.filter((r) => r.id !== row.id));
            }}
            onSkip={async (row) => {
              const jobId = (chatJob && chatJob.id) || (job && job.id);
              if (jobId) await magnet.acceptReview({ id: jobId, fieldId: row.id, skip: true, label: row.label });
              setLeftovers((rows) => rows.filter((r) => r.id !== row.id));
            }}
            onOpenMail={(href) => openGmail(null, href)}
            onResolveMail={(id, action, url) => {
              magnet.mailResolve({ id, action, url });
              refresh();
              toast(action === 'skip' ? 'Not a reject' : 'Marked rejected');
            }}
          />
        </View>
      </View>

      <ShellTabs
        pane={pane}
        reviewCount={leftovers.length}
        onPane={(next) => setPane(next)}
      />

      <SettingsScreen
        open={settingsOpen}
        settings={settingsSnap.settings}
        resumes={resumes}
        mail={settingsSnap.mail}
        bundlePath={bundlePathHint()}
        onClose={() => setSettingsOpen(false)}
        onSaveSettings={(patch) => {
          magnet.setSettings(patch);
          toast('Saved');
          refresh();
        }}
        voice={voice}
        systemPrompt={systemPrompt}
        onSaveVoice={(text) => {
          magnet.setVoice({ text });
          toast('Voice saved');
        }}
        onSavePrompt={(text) => {
          magnet.setSystemPrompt({ text });
          toast('Prompt saved');
        }}
        onImportResume={importResume}
        onExport={async () => {
          const path = await persistStore();
          try {
            const sharing = require('expo-sharing');
            if (path && (await sharing.isAvailableAsync())) await sharing.shareAsync(path);
            else toast(path || 'Exported in memory');
          } catch {
            toast(path || 'Bundle saved');
          }
        }}
        onImportBundle={async () => {
          try {
            const picker = require('expo-document-picker');
            const picked = await picker.getDocumentAsync({ type: 'application/json' });
            if (picked.canceled) return;
            const file = picked.assets && picked.assets[0];
            const fs = require('expo-file-system/legacy');
            const raw = await fs.readAsStringAsync(file.uri);
            magnet.importBundle({ bundle: JSON.parse(raw) });
            toast('Bundle imported');
            refresh();
          } catch (err) {
            toast(err.message || 'Import failed');
          }
        }}
        onMailImport={async (text) => {
          const lines = String(text || '').split('\n');
          const out = await magnet.mailImport({
            messages: [
              {
                id: `paste-${Date.now()}`,
                from: lines[0] || '',
                subject: lines[1] || lines[0] || '',
                text,
              },
            ],
          });
          toast((out.queued || []).length ? `${out.queued.length} need you — Jobs bell` : 'Mail classified');
          refresh();
          if ((out.queued || []).length) pingSound(magnet, webRef);
        }}
        onOpenGmail={() => {
          setSettingsOpen(false);
          openGmail();
        }}
      />
      <GmailScreen
        open={gmailOpen}
        mail={settingsSnap.mail}
        queue={mailSnap.queue}
        settings={settingsSnap.settings}
        phase={gmailPhase}
        onPhase={setGmailPhase}
        intent={gmailIntent}
        threadHref={gmailHref}
        onBackRef={gmailBackRef}
        onClose={() => {
          setGmailOpen(false);
          setGmailPhase('idle');
          setGmailIntent(null);
          setGmailHref(null);
        }}
        onSaveSettings={(patch) => {
          magnet.setSettings(patch);
          refresh();
        }}
        onConnected={async ({ email, reply }) => {
          await magnet.mailConnect();
          toast(reply || (email ? `Signed in as ${email}` : 'Signed in to Gmail'));
          refresh();
        }}
        onImported={async (messages) => {
          const out = await magnet.mailImport({ messages });
          const queued = (out.queued || []).length;
          toast(queued ? `Scanned ${(messages || []).length}. ${queued} need you — Jobs bell` : `Scanned ${(messages || []).length}.`);
          refresh();
          if (queued) pingSound(magnet, webRef);
        }}
        onSignOut={async () => {
          await magnet.mailSignOut();
          toast('Signed out of Gmail');
          refresh();
        }}
        onScanApi={async () => {
          const out = await magnet.mailScan();
          refresh();
          if ((out.queued || []).length) pingSound(magnet, webRef);
          return out;
        }}
        onResolve={(id, action, url) => {
          magnet.mailResolve({ id, action, url });
          refresh();
        }}
      />
      <HuntLayer
        webRef={(r) => huntBridge.setWebView(r)}
        url={huntUrl}
        uiLanguage={(settingsSnap.settings && settingsSnap.settings.uiLanguage) || 'en-US'}
        loginOpen={huntLoginOpen}
        loginPrompt={huntLoginPrompt}
        width={winW}
        height={winH}
        onMessage={(raw) => huntBridge.handleMessage(raw)}
        onSignedIn={() => finishHuntLogin({ ok: true })}
        onSkip={() => finishHuntLogin({ skipped: true })}
      />
      <View style={{ height: 0, opacity: 0 }} collapsable={false} key={tick} />
    </GestureHandlerRootView>
  );
}
