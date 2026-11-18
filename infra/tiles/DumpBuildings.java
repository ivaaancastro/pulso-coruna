import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.reader.SourceFeature;
import java.io.PrintWriter;
import java.nio.file.Path;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.Point;

/** Vuelca los edificios OSM (id, tags de altura, centroide lon/lat, area m2) a TSV. */
public class DumpBuildings extends Profile.NullProfile {
  static PrintWriter out;

  public static void main(String[] args) throws Exception {
    out = new PrintWriter(args[1]);
    out.println("id\tkind\theight\tlevels\tminh\tarea\tlon\tlat\tring");
    Planetiler.create(com.onthegomap.planetiler.config.Arguments.fromArgs(
      new String[] {"--bounds=-8.58,43.27,-8.25,43.45", "--tmpdir=infra/tiles/.work/tmp2", "--nodemap_type=sortedtable", "--storage=ram", "--threads=1"}))
      .setProfile(new DumpBuildings())
      .addOsmSource("osm", Path.of(args[0]))
      .overwriteOutput(Path.of("infra/tiles/.work/dump-out.pmtiles"))
      .run();
    out.close();
  }

  @Override
  public void processFeature(SourceFeature f, FeatureCollector features) {
    if (!f.canBePolygon()) return;
    if (!(f.hasTag("building") || f.hasTag("building:part"))) return;
    try {
      Geometry g = f.latLonGeometry();
      Point c = g.getCentroid();
      if (c.getX() < -8.58 || c.getX() > -8.25 || c.getY() < 43.27 || c.getY() > 43.45) return;
      org.locationtech.jts.geom.Coordinate[] cs = (g instanceof org.locationtech.jts.geom.MultiPolygon mp
        ? ((org.locationtech.jts.geom.Polygon) mp.getGeometryN(0)) : (org.locationtech.jts.geom.Polygon) g).getExteriorRing().getCoordinates();
      StringBuilder ring = new StringBuilder();
      for (org.locationtech.jts.geom.Coordinate k : cs) ring.append(Math.round(k.x * 1e7) / 1e7).append(' ').append(Math.round(k.y * 1e7) / 1e7).append(',');
      String kind = f.hasTag("building") ? "building" : "part";
      synchronized (DumpBuildings.class) {
        out.println(f.id() + "\t" + kind + "\t" + nz(f.getTag("height")) + "\t" + nz(f.getTag("building:levels")) + "\t"
          + nz(f.getTag("min_height")) + "\t" + Math.round(f.areaMeters()) + "\t" + c.getX() + "\t" + c.getY() + "\t" + ring);
      }
    } catch (Exception e) {
      // ignorar geometrias invalidas
    }
  }

  static String nz(Object o) {
    return o == null ? "" : String.valueOf(o).replace('\t', ' ');
  }
}
