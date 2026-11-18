import { useAuth } from '@/lib/AuthContext';
import HomeHero from '@/components/home/HomeHero';
import FeatureTiles from '@/components/home/FeatureTiles';
import FeaturedCourses from '@/components/home/FeaturedCourses';
import AdminCard from '@/components/home/AdminCard';
import OrientationCard from '@/components/home/OrientationCard';

export default function Home() {
  const { user, isAdmin } = useAuth();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      <HomeHero user={user} />
      <OrientationCard />
      {isAdmin && <AdminCard />}
      <FeatureTiles />
      <FeaturedCourses />
    </div>
  );
}
