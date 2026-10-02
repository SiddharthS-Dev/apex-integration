import { Link } from 'react-router-dom';
import { Award, BookOpen, ChevronRight, ClipboardList, Library, Zap } from 'lucide-react';
import { IconTile, Panel, SectionHeader } from '@/components/dashboard/DashParts';

export default function QuickActions({ isAdmin }) {
  const actions = [
    { to: '/courses', icon: Library, tone: 'violet', title: 'Browse Courses', text: 'Explore new skills' },
    { to: '/tests', icon: ClipboardList, tone: 'blue', title: 'Take Test', text: 'Check your knowledge' },
    // Same destination as the Playbooks nav item.
    { to: isAdmin ? '/admin/playbooks' : '/playbooks', icon: BookOpen, tone: 'cyan', title: 'Open Playbooks', text: 'Learn step by step' },
    { to: '/certificates', icon: Award, tone: 'orange', title: 'View Certificates', text: 'Track achievements' },
  ];
  return (
    <Panel>
      <SectionHeader icon={Zap} title="Quick Actions" />
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
        {actions.map(({ to, icon, tone, title, text }) => (
          <Link key={to} to={to} className="group dash-panel dash-hover p-3 flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0 active:scale-[0.98]">
            <IconTile icon={icon} tone={tone} />
            <div className="min-w-0 basis-full order-last">
              <div className="text-sm font-semibold leading-tight">{title}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{text}</div>
            </div>
            <ChevronRight className="ml-auto w-4 h-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    </Panel>
  );
}
