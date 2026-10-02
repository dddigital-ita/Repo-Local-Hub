import { GlassShell, PlainShell } from "./shell";
import { InnerFixed } from "./fixedmod";
import PortaledFixed from "./portaled";
import GlassWithDefault from "./glassdefault";
import { GlassCn, InnerCnFixed } from "./cnfixture";

/** Il caso simbolico: tutte le forme del rischio in un solo albero. */
export default function Demo() {
  return (
    <>
      <GlassShell>
        <InnerFixed />
      </GlassShell>
      <PlainShell>
        <InnerFixed />
      </PlainShell>
      <GlassShell>
        <PortaledFixed />
      </GlassShell>
      <GlassWithDefault />
      <GlassCn>
        <InnerCnFixed />
      </GlassCn>
      <div className="fixed top-0 left-0">legale: nessun antenato glass</div>
    </>
  );
}
