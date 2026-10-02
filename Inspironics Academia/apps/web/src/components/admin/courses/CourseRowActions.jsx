import { useNavigate } from 'react-router-dom';
import { Archive, Eye, EyeOff, MoreHorizontal, Pencil, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function CourseRowActions({ course, onUpdate, disabled }) {
  const navigate = useNavigate();
  const isPublished = course.status === 'published';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled} aria-label="Course actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => navigate(`/admin/courses/${course.id}/edit`)}>
          <Pencil className="w-4 h-4 mr-2" /> Edit
        </DropdownMenuItem>
        {course.playbook_id && (
          <DropdownMenuItem onClick={() => navigate(`/admin/studio/${course.playbook_id}`)}>
            <Wand2 className="w-4 h-4 mr-2" /> Open studio
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {isPublished ? (
          <DropdownMenuItem onClick={() => onUpdate(course, { status: 'pending_review', published: false }, 'Course unpublished')}>
            <EyeOff className="w-4 h-4 mr-2" /> Unpublish
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onUpdate(course, { status: 'published', published: true }, 'Course published')}>
            <Eye className="w-4 h-4 mr-2" /> Publish
          </DropdownMenuItem>
        )}
        {course.status !== 'archived' && (
          <DropdownMenuItem onClick={() => onUpdate(course, { status: 'archived', published: false }, 'Course archived')}>
            <Archive className="w-4 h-4 mr-2" /> Archive
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
