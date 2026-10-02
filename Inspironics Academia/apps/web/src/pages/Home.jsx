import { useAuth } from '@/lib/AuthContext';
import HomeHero from '@/components/home/HomeHero';
import FeatureTiles from '@/components/home/FeatureTiles';
import FeaturedCourses from '@/components/home/FeaturedCourses';
import AdminCard from '@/components/home/AdminCard';

export default function Home() {
  const { user, isAdmin } = useAuth();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      <HomeHero user={user} />
      {isAdmin && <AdminCard />}
      <FeatureTiles />
      <FeaturedCourses />
    </div>
  );
}
