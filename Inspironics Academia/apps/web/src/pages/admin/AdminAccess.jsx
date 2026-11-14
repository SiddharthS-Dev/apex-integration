import { useSearchParams } from 'react-router-dom';
import { Building2, KeyRound, Link2, ScrollText, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/PageHeader';
import { CoreUnavailable } from '@/components/core/CoreNotice';
import PeopleTab from '@/components/core/PeopleTab';
import OrganisationsTab from '@/components/core/OrganisationsTab';
import LinksTab from '@/components/core/LinksTab';
import AuditTab from '@/components/core/AuditTab';
import { coreAvailable } from '@/lib/core';

const TABS = ['people', 'organisations', 'links', 'audit'];

// People & access (APEX Core, R1): who someone is across the APEX apps, which organisations they belong
// to, which scoped roles they hold, which app accounts are linked to them, and the audit trail.
// The route sits behind AdminGuard; the API enforces every permission again on each call.
export default function AdminAccess() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'people';
  const userId = params.get('user') || null;
  const update = (next) => setParams((p) => {
    const out = new URLSearchParams(p);
    for (const [k, v] of Object.entries(next)) { if (v) out.set(k, v); else out.delete(k); }
    return out;
  }, { replace: true });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader
        title="People & access"
        description="Accounts, organisations, roles and linked app accounts across APEX"
        icon={KeyRound}
      />
      {!coreAvailable ? <CoreUnavailable /> : (
        <Tabs value={tab} onValueChange={(v) => update({ tab: v })}>
          <TabsList className="mb-6 flex-wrap h-auto">
            <TabsTrigger value="people"><Users className="w-4 h-4" /> People</TabsTrigger>
            <TabsTrigger value="organisations"><Building2 className="w-4 h-4" /> Organisations</TabsTrigger>
            <TabsTrigger value="links"><Link2 className="w-4 h-4" /> Account links</TabsTrigger>
            <TabsTrigger value="audit"><ScrollText className="w-4 h-4" /> Audit log</TabsTrigger>
          </TabsList>
          <TabsContent value="people"><PeopleTab selectedId={userId} onSelect={(id) => update({ user: id })} /></TabsContent>
          <TabsContent value="organisations"><OrganisationsTab /></TabsContent>
          <TabsContent value="links"><LinksTab /></TabsContent>
          <TabsContent value="audit"><AuditTab /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
