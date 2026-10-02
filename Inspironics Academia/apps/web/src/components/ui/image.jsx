import * as React from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

// Content image with lazy loading and a graceful fallback when the source fails.
const Image = React.forwardRef(({ className, src, alt = '', fallbackClassName, ...props }, ref) => {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className, fallbackClassName)}>
        <ImageOff className="w-5 h-5" />
      </div>
    );
  }
  return <img ref={ref} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={className} {...props} />;
});
Image.displayName = 'Image';

export { Image };
export default Image;
