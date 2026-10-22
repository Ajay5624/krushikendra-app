/* Assembles KrushiKendra.apk entirely from the repository, with no base APK.
   ---------------------------------------------------------------------------
   tools/build-apk.sh needs the shipped APK on disk because it copies the Android
   shell out of it. This variant reads that shell from src/ instead, where the
   extracted classes.dex, AndroidManifest.xml, resources.arsc and res/ are
   committed, so a clean clone can produce a release build.

   Same rules as the original shell, same reasons:
     * classes.dex serves the app from the fake origin https://app.krushikendra/,
       which is where the shop's IndexedDB lives, and implements the AndroidBridge
       that shim.js uses for Downloads backups, system printing and file picking.
       It is never recompiled here, only stored.
     * resources.arsc is written STORED because Android memory-maps it.

   The set of shell entries is whatever src/ holds, so anything unexpected at the
   top of src/ is an error rather than a silently omitted file.

   usage: java Assemble <srcDir> <out.apk>
   then:  zipalign -f -p 4 out.apk aligned.apk
          apksigner sign --ks <keystore> --ks-key-alias krushikendra aligned.apk
*/
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public class Assemble {
  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("usage: Assemble <srcDir> <out.apk>");
    Path src = Paths.get(args[0]), out = Paths.get(args[1]);

    List<Entry> entries = new ArrayList<>();
    collect(src.resolve("AndroidManifest.xml"), "AndroidManifest.xml", false, entries);
    collect(src.resolve("resources.arsc"), "resources.arsc", true, entries);
    collect(src.resolve("classes.dex"), "classes.dex", false, entries);
    collectTree(src.resolve("res"), entries);
    collectTree(src.resolve("assets"), entries);

    try (DirectoryStream<Path> top = Files.newDirectoryStream(src)) {
      for (Path p : top) {
        String n = p.getFileName().toString();
        if (n.equals("AndroidManifest.xml") || n.equals("resources.arsc") || n.equals("classes.dex")
            || n.equals("res") || n.equals("assets") || n.equals("META-INF")) continue;
        throw new IOException("unexpected entry under src/, not packed: " + n
            + " — add it to Assemble.java or remove it");
      }
    }

    entries.sort(Comparator.comparing(e -> e.name));
    try (ZipOutputStream zos = new ZipOutputStream(
             new BufferedOutputStream(Files.newOutputStream(out)))) {
      zos.setLevel(9);
      for (Entry e : entries) {
        byte[] raw = Files.readAllBytes(e.file);
        ZipEntry ze = new ZipEntry(e.name);
        ze.setTime(0);                       // fixed date: the same tree assembles identically
        if (e.stored) {
          CRC32 crc = new CRC32(); crc.update(raw);
          ze.setMethod(ZipEntry.STORED);
          ze.setSize(raw.length); ze.setCompressedSize(raw.length); ze.setCrc(crc.getValue());
        } else {
          ze.setMethod(ZipEntry.DEFLATED);
        }
        zos.putNextEntry(ze);
        zos.write(raw);
        zos.closeEntry();
      }
    }
    System.out.println("entries written: " + entries.size());
  }

  private record Entry(Path file, String name, boolean stored) {}

  private static void collect(Path file, String name, boolean stored, List<Entry> into) throws IOException {
    if (!Files.isRegularFile(file)) throw new IOException("missing required shell entry: " + name);
    into.add(new Entry(file, name, stored));
  }

  private static void collectTree(Path dir, List<Entry> into) throws IOException {
    if (!Files.isDirectory(dir)) throw new IOException("missing required directory: " + dir);
    try (java.util.stream.Stream<Path> walk = Files.walk(dir)) {
      walk.filter(Files::isRegularFile).forEach(p -> {
        String rel = dir.getParent().relativize(p).toString().replace(File.separatorChar, '/');
        into.add(new Entry(p, rel, false));
      });
    }
  }
}
