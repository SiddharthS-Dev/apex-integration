import Gallery from "../components/Gallery";
import data from "../data/showcase.json";

// Server component: loads the dataset and hands it to the client gallery.
// By default it uses the bundled JSON (no backend required). To use the
// Express + Postgres API instead, set NEXT_PUBLIC_DATA_SOURCE to the API URL
// and fetch it here, e.g.:
//   const res = await fetch(process.env.NEXT_PUBLIC_DATA_SOURCE, { cache: "no-store" });
//   const data = await res.json();

export default function Page() {
  return (
    <main>
      <header className="max-w-[1560px] mx-auto px-6 pt-14 pb-7">
        <div className="inline-flex items-center gap-2 text-[11px] tracking-[4px] uppercase text-cyan font-bold mb-4">
          Premium Interactive Knowledge Platform
        </div>
        <h1 className="text-[clamp(34px,5.4vw,58px)] font-extrabold leading-[1.04] tracking-tight max-w-[17ch]">
          Explore{" "}
          <span className="bg-gradient-to-r from-cyan to-emer bg-clip-text text-transparent">
            {data.total} infographic architectures
          </span>{" "}
          — flip any card, understand the whole system.
        </h1>
        <p className="mt-4 text-mut text-[17px] max-w-[680px]">
          Hover an infographic to flip it in 3D and instantly read its business
          objective, process flow, components, architecture, benefits and key
          takeaway.
        </p>
      </header>
      <Gallery data={data} />
    </main>
  );
}
