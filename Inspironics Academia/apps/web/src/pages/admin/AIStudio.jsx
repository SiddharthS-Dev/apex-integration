import { useSearchParams } from 'react-router-dom';
import { AudioLines, BarChart3, BookOpen, Clapperboard, HardDrive, History, Sparkles, Wand2 } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ContentGenerator from '@/components/studio/ContentGenerator';
import CourseGeneration from '@/components/studio/CourseGeneration';
import GenerationHistory from '@/components/studio/GenerationHistory';
import StorageDashboard from '@/components/studio/StorageDashboard';
import UsageBudget from '@/components/studio/UsageBudget';
import VideoStudio from '@/components/studio/VideoStudio';
import VoiceStudio from '@/components/studio/VoiceStudio';
import { Notice } from '@/components/studio/StudioFields';
import { useStudioConfig } from '@/lib/studio';

// AI Studio: content generation, voice-over, video production, the generation history and the usage &
// budget dashboard, in one place. Everything runs on the API server with its own provider keys.
export default function AIStudio() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'content';
  const { data: config, isLoading, error } = useStudioConfig();
  const setTab = (t) => setParams({ tab: t }, { replace: true });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title="AI Studio" description="Generate learning content, voice-overs and narrated videos — with every request tracked against your budget" icon={Wand2} />
      {isLoading && <LoadingState label="Loading AI Studio…" />}
      {error && <Notice tone="error">Could not load AI Studio: {error.message}</Notice>}
      {config && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-1 ${config.ai.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>AI text: {config.ai.enabled ? `${config.ai.provider} · ${config.ai.model}` : 'not configured'}{config.ai.fallback ? ` (fallback ${config.ai.fallback})` : ''}</span>
            <span className={`rounded-full px-2.5 py-1 ${config.voice.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>Voice: {config.voice.enabled ? config.voice.default_provider : 'not configured'}</span>
            <span className={`rounded-full px-2.5 py-1 ${config.video.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>Video: {config.video.enabled ? `FFmpeg · ${config.video.width}×${config.video.height}` : 'not available'}</span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">Automatic voice-over: {config.auto_generate_audio ? 'on' : 'off (on demand)'}</span>
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <div className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="courses" className="gap-1.5"><BookOpen className="h-4 w-4" /> Course generation</TabsTrigger>
                <TabsTrigger value="content" className="gap-1.5"><Sparkles className="h-4 w-4" /> Content</TabsTrigger>
                <TabsTrigger value="voice" className="gap-1.5"><AudioLines className="h-4 w-4" /> Voice</TabsTrigger>
                <TabsTrigger value="video" className="gap-1.5"><Clapperboard className="h-4 w-4" /> Video</TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5"><History className="h-4 w-4" /> History</TabsTrigger>
                <TabsTrigger value="usage" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Usage &amp; budget</TabsTrigger>
                <TabsTrigger value="storage" className="gap-1.5"><HardDrive className="h-4 w-4" /> Storage &amp; Dropbox</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="courses" className="pt-4"><CourseGeneration config={config} /></TabsContent>
            <TabsContent value="content" className="pt-4"><ContentGenerator config={config} /></TabsContent>
            <TabsContent value="voice" className="pt-4"><VoiceStudio config={config} /></TabsContent>
            <TabsContent value="video" className="pt-4"><VideoStudio config={config} /></TabsContent>
            <TabsContent value="history" className="pt-4"><GenerationHistory /></TabsContent>
            <TabsContent value="usage" className="pt-4"><UsageBudget /></TabsContent>
            <TabsContent value="storage" className="pt-4"><StorageDashboard /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
