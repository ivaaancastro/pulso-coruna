// Teselas OpenMapTiles de A Coruña con plantas del Catastro (M2.7, ADR-0013).
// Copia de OpenMapTilesMain.run (Planetiler 0.10.2) con un perfil que, para edificios OSM sin `height`
// ni `building:levels`, inyecta `building:levels` desde la tabla w<id>/r<id> -> plantas generada por
// infra/tiles/build-heights.mjs. OpenMapTiles calcula después render_height = ceil(levels * 3,66).
// Uso (desde la raíz del repo; lo invoca infra/tiles/build.sh):
//   java -cp infra/tiles/.work/planetiler.jar infra/tiles/CorunaTiles.java --heights=<heights.tsv> <opciones de Planetiler>
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmSourceFeature;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.openmaptiles.OpenMapTilesProfile;
import org.openmaptiles.generated.OpenMapTilesSchema;

public class CorunaTiles {
  static final String CATASTRO_CREDIT =
    "<a href=\"https://www.catastro.hacienda.gob.es/\" target=\"_blank\">© Dirección General del Catastro (Ministerio de Hacienda)</a>";

  /** Perfil OpenMapTiles que completa las plantas de los edificios desde una tabla externa. */
  static class HeightsProfile extends OpenMapTilesProfile {
    private final Map<String, String> levels;
    long injected = 0;

    HeightsProfile(Planetiler planetiler, Map<String, String> levels) {
      super(planetiler);
      this.levels = levels;
    }

    @Override
    public void processFeature(SourceFeature f, FeatureCollector features) {
      if (f instanceof OsmSourceFeature<?> o && f.canBePolygon() && f.hasTag("building")
        && !f.hasTag("height") && !f.hasTag("building:levels")) {
        boolean rel = o.originalElement() instanceof OsmElement.Relation;
        String n = levels.get((rel ? "r" : "w") + f.id());
        if (n != null) {
          f.tags().put("building:levels", n); // tags() de OSM es mutable (verificado)
          injected++;
        }
      }
      super.processFeature(f, features);
    }

    @Override
    public String attribution() {
      return super.attribution() + " " + CATASTRO_CREDIT;
    }
  }

  public static void main(String[] argv) throws Exception {
    Arguments args = Arguments.fromArgsOrConfigFile(argv);
    Path heightsFile = args.file("heights", "TSV w<id>/r<id> -> plantas (build-heights.mjs)", Path.of("infra/tiles/.work/heights.tsv"));
    Map<String, String> levels = new HashMap<>();
    for (String line : Files.readAllLines(heightsFile)) {
      String[] p = line.split("\t");
      if (p.length == 2) levels.put(p[0], p[1]);
    }
    System.out.println("Plantas del Catastro cargadas: " + levels.size());

    Path sources = args.file("download_dir", "download directory", Path.of("data", "sources"));
    String area = args.getString("area", "name of the extract", "monaco");
    HeightsProfile[] holder = new HeightsProfile[1];
    Planetiler.create(args)
      .setDefaultLanguages(OpenMapTilesSchema.LANGUAGES)
      .setProfile(pl -> holder[0] = new HeightsProfile(pl, levels))
      .addShapefileSource("EPSG:3857", OpenMapTilesProfile.LAKE_CENTERLINE_SOURCE,
        sources.resolve("lake_centerline.shp.zip"), "https://dev.maptiler.download/geodata/omt/lake_centerline.shp.zip")
      .addShapefileSource(OpenMapTilesProfile.WATER_POLYGON_SOURCE,
        sources.resolve("water-polygons-split-3857.zip"), "https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip")
      .addNaturalEarthSource(OpenMapTilesProfile.NATURAL_EARTH_SOURCE,
        sources.resolve("natural_earth_vector.sqlite.zip"), "https://dev.maptiler.download/geodata/omt/natural_earth_vector.sqlite.zip")
      .addOsmSource(OpenMapTilesProfile.OSM_SOURCE, sources.resolve(area.replaceAll("[^a-zA-Z]+", "_") + ".osm.pbf"), "geofabrik:" + area)
      .setOutput("pmtiles", Path.of("data", "output.pmtiles"))
      .run();
    System.out.println("Edificios con plantas inyectadas desde el Catastro: " + holder[0].injected);
  }
}
