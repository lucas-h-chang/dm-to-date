import { Button } from '@/components/ui/button'
import { CalendarIcon, InstagramIcon, ArrowRight } from 'lucide-react'

const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="text-center space-y-8 p-8 max-w-2xl">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold text-white">
            IG Calendar Bridge
          </h1>
          <p className="text-xl text-gray-300">
            Turn Instagram event flyers into Google Calendar events automatically
          </p>
        </div>
        
        <div className="flex items-center justify-center gap-4 text-gray-400">
          <InstagramIcon className="h-8 w-8" />
          <ArrowRight className="h-6 w-6" />
          <CalendarIcon className="h-8 w-8" />
        </div>
        
        <div className="space-y-4">
          <Button asChild size="lg" className="text-lg px-8">
            <a href="/auth">Get Started</a>
          </Button>
          <p className="text-sm text-gray-400">
            Connect your accounts and start automating your event planning
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
