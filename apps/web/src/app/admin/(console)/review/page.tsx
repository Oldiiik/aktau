import { candidateQueue, getSql } from '@aktau/server'
import { ReviewQueue } from '@/components/admin'

export const dynamic = 'force-dynamic'

export default async function ReviewPage() {
  const items = await candidateQueue(getSql(), 'REVIEW_REQUIRED', 100)
  return (
    <>
      <div className="flex flex-col gap-1"><h1 className="t-title text-text">Review queue</h1><p className="t-body text-secondary">Nothing reaches the public city state without passing here (unless an official structured source is configured for auto-publish).</p></div>
      <ReviewQueue initial={JSON.parse(JSON.stringify(items))} />
    </>
  )
}
