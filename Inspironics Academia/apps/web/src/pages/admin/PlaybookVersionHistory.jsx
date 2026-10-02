import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GitCompare, History } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import VersionPicker from '@/components/admin/versions/VersionPicker';
import VersionComparison from '@/components/admin/versions/VersionComparison';

export default function PlaybookVersionHistory() {
  const { playbookId } = useParams();
  const [picked, setPicked] = useState({ oldId: null, newId: null });

  const { data, isLoading } = useQuery({
    queryKey: ['playbook-versions', playbookId],
    queryFn: async () => {
      const [playbook, versions] = await Promise.all([
        api.entities.Playbook.get(playbookId).catch(() => null),
        api.entities.PlaybookVersion.filter({ playbook_id: playbookId }, '-created_date', 200),
      ]);
      return { playbook, versions };
    },
    enabled: !!playbookId,
  });

  const versions = data?.versions || [];
  const newVersion = versions.find((v) => v.id === picked.newId) || versions[0];
  const oldVersion = versions.find((v) => v.id === picked.oldId) || versions[1] || versions[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader
        icon={History}
        title="Version History"
        description={data?.playbook?.title || 'Compare extracted playbook versions'}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/playbooks"><ArrowLeft />Back to playbooks</Link>
          </Button>
        }
      />
      {isLoading ? (
        <LoadingState label="Loading versions…" />
      ) : !versions.length ? (
        <EmptyState icon={GitCompare} title="No versions yet" description="A version snapshot is created each time the playbook is extracted." />
      ) : (
        <div className="space-y-6">
          <VersionPicker
            versions={versions}
            oldId={oldVersion?.id}
            newId={newVersion?.id}
            onOldChange={(id) => setPicked((p) => ({ ...p, oldId: id }))}
            onNewChange={(id) => setPicked((p) => ({ ...p, newId: id }))}
          />
          {versions.length === 1 && (
            <p className="text-sm text-muted-foreground">Only one version exists — upload and re-process the playbook to compare changes.</p>
          )}
          <VersionComparison key={`${oldVersion?.id}-${newVersion?.id}`} oldVersion={oldVersion} newVersion={newVersion} />
        </div>
      )}
    </div>
  );
}
