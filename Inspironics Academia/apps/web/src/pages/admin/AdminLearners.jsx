import { MessageSquare, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/PageHeader';
import InviteUserDialog from '@/components/admin/learners/InviteUserDialog';
import LearnersTab from '@/components/admin/learners/LearnersTab';
import FeedbackTab from '@/components/admin/learners/FeedbackTab';

export default function AdminLearners() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader
        title="Learners"
        description="Users, course progress, test performance and lesson feedback"
        icon={Users}
        actions={<InviteUserDialog />}
      />
      <Tabs defaultValue="learners">
        <TabsList className="mb-4">
          <TabsTrigger value="learners"><Users className="w-4 h-4 mr-2" /> Learners</TabsTrigger>
          <TabsTrigger value="feedback"><MessageSquare className="w-4 h-4 mr-2" /> Feedback</TabsTrigger>
        </TabsList>
        <TabsContent value="learners"><LearnersTab /></TabsContent>
        <TabsContent value="feedback"><FeedbackTab /></TabsContent>
      </Tabs>
    </div>
  );
}
