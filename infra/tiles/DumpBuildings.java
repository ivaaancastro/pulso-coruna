// Vuelca los edificios OSM del bbox (id tipado w/r, tags de altura, centroide, anillo exterior) a TSV.
// Paso previo de las alturas reales (M2.7): lo consume infra/tiles/build-heights.mjs.
// Uso (desde la raíz del repo):
//   java -cp infra/tiles/.work/planetiler.jar infra/tiles/DumpBuildings.java <osm.pbf> <salida.tsv> <lonMin,latMin,lonMax,latMax>
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmSourceFeature;
import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.MultiPolygon;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.Polygon;

public class DumpBuildings extends Profile.NullProfile {
  static PrintWriter out;
  static double[] bb;

  public static void main(String[] args) throws Exception {
    out = new PrintWriter(args[1]);
    String[] b = args[2].split(",");
    bb = new double[] {Double.parseDouble(b[0]), Double.parseDouble(b[1]), Double.parseDouble(b[2]), Double.parseDouble(b[3])};
    out.println("id\tkind\theight\tlevels\tminh\tarea\tlon\tlat\tring");
    Path tmp = Path.of("infra/tiles/.work/tmp-dump");
    Files.createDirectories(tmp);
    Planetiler.create(Arguments.fromArgs(
      new String[] {"--bounds=" + args[2], "--tmpdir=" + tmp, "--nodemap_type=sortedtable", "--storage=ram", "--threads=1"}))
      .setProfile(new DumpBuildings())
      .addOsmSource("osm", Path.of(args[0]))
      .overwriteOutput(tmp.resolve("dump.pmtiles"))
      .run();
    out.close();
  }

  /** Clave estable de un elemento OSM: w<id> (vía) o r<id> (relación multipolígono). */
  static String key(SourceFeature f) {
    boolean rel = f instanceof OsmSourceFeature<?> o && o.originalElement() instanceof OsmElement.Relation;
    return (rel ? "r" : "w") + f.id();
  }

  @Override
  public void processFeature(SourceFeature f, FeatureCollector features) {
    if (!f.canBePolygon()) return;
    if (!(f.hasTag("building") || f.hasTag("building:part"))) return;
    try {
      Geometry g = f.latLonGeometry();
      Point c = g.getCentroid();
      if (c.getX() < bb[0] || c.getX() > bb[2] || c.getY() < bb[1] || c.getY() > bb[3]) return;
      Polygon p = g instanceof MultiPolygon mp ? (Polygon) mp.getGeometryN(0) : (Polygon) g;
      StringBuilder ring = new StringBuilder();
      for (Coordinate k : p.getExteriorRing().getCoordinates()) {
        ring.append(Math.round(k.x * 1e7) / 1e7).append(' ').append(Math.round(k.y * 1e7) / 1e7).append(',');
      }
      String kind = f.hasTag("building") ? "building" : "part";
      synchronized (DumpBuildings.class) {
        out.println(key(f) + "\t" + kind + "\t" + nz(f.getTag("height")) + "\t" + nz(f.getTag("building:levels")) + "\t"
          + nz(f.getTag("min_height")) + "\t" + Math.round(f.areaMeters()) + "\t" + c.getX() + "\t" + c.getY() + "\t" + ring);
      }
    } catch (Exception e) {
      // geometría inválida: se ignora
    }
  }

  static String nz(Object o) {
    return o == null ? "" : String.valueOf(o).replace('\t', ' ');
  }
}
