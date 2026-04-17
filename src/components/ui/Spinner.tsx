export default function Spinner({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-spin h-6 w-6 border-3 border-navy-600 border-t-transparent rounded-full ${className}`} />
  );
}
