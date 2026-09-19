import { useCallback, useEffect, useMemo, useState } from 'react'
import Navbar from '../components/Navbar'
import Loader from '#shared/ui/Loader'
import { AboutSection, ContactSection, Footer, HeroSection, IntroSequence } from '#features/site'
import { EcosystemExplorer } from '#features/ecosystem'
import { DailySpotlight, Gallery, Lightbox, loadShowcase, rebuildWithCustom, spotlightFor } from '#features/showcase'
import { CopilotPanel } from '#features/copilot'

export default function Home() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [introDone, setIntroDone] = useState(false)
  const [activeFilter, setActiveFilter] = useState(null)
  /*
   * The one plate viewer on the page.
   *
   * There used to be three — one in the gallery, one in the spotlight, one here
   * for the copilot and #<id> share links — and each of them managed the body
   * scroll lock, so overlapping ones could leave the page permanently
   * unscrollable. Hoisting it here also keeps prev/next meaningful: the caller
   * passes the list it wants navigated, so the gallery still steps through the
   * current filter while the copilot steps through the whole corpus.
   *
   * @type {[{items: object[], index: number} | null, Function]}
   */
  const [viewer, setViewer] = useState(null)

  const openPlate = useCallback((items, index) => {
    if (index == null || index < 0 || !items?.length) return
    setViewer({ items, index })
  }, [])

  useEffect(() => {
    loadShowcase()
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  // keep the dataset in step with locally-added plates
  useEffect(() => {
    const onChange = () => {
      const next = rebuildWithCustom()
      if (next) setData({ ...next })
    }
    window.addEventListener('inspironics:custom-items', onChange)
    return () => window.removeEventListener('inspironics:custom-items', onChange)
  }, [])

  // Share links look like /#<item.f>; open that plate on load and on hashchange.
  useEffect(() => {
    if (!data) return
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ''))
      if (!id) return
      const index = data.items.findIndex((x) => x.f === id)
      if (index >= 0) openPlate(data.items, index)
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [data, openPlate])

  const closePlate = useCallback(() => {
    setViewer(null)
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  const route = useCallback((r, node) => {
    setActiveFilter(r ? { ...r, sourceName: node?.name || 'Ecosystem', at: Date.now() } : null)
  }, [])

  const spotlight = useMemo(() => (data ? spotlightFor(data.items) : null), [data])

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="eyebrow">Data error</p>
          <h1 className="mt-3 text-2xl font-bold text-chalk">The showcase corpus could not be loaded.</h1>
          <p className="mt-3 text-sm text-muted">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return <Loader label="Indexing the innovation corpus" />

  return (
    <>
      {!introDone && <IntroSequence onDone={() => setIntroDone(true)} />}

      <Navbar />

      <main id="main" className="relative">
        <HeroSection stats={data} />
        <EcosystemExplorer items={data.items} onRoute={route} />
        <Gallery
          data={data}
          activeFilter={activeFilter}
          onClearActive={() => setActiveFilter(null)}
          onAdded={() => setActiveFilter(null)}
          onOpenPlate={openPlate}
        />
        <DailySpotlight item={spotlight} items={data.items} onOpenPlate={openPlate} />
        <AboutSection stats={data} heroItem={spotlight} />
        <ContactSection />
      </main>

      <Footer cats={data.cats} techs={data.techs} onRoute={route} />

      <CopilotPanel onOpenItem={(it) => openPlate(data.items, data.items.findIndex((x) => x.f === it.f))} />

      <Lightbox
        items={viewer?.items ?? data.items}
        index={viewer?.index ?? null}
        onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
        onClose={closePlate}
      />
    </>
  )
}
