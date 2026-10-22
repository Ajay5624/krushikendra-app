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

   Optionally the binary manifest is version-stamped in place:
     java Assemble <srcDir> <out.apk> <versionCode> <versionName>
   Android refuses an in-place update unless versionCode rises, and the manifest
   is stored verbatim, so without this every build reports the version of the APK
   the shell was extracted from. The patch rewrites only the versionCode integer
   and, in the string pool, the characters of the versionName string - both in
   place, so the new name must be exactly as long as the old one or the build
   fails. The method asserts that precisely those bytes changed and nothing else,
   which is what keeps "the shell is never rewritten" true in spirit: the manifest
   is not recompiled, restructured or re-serialised.

   usage: java Assemble <srcDir> <out.apk> [<versionCode> <versionName>]
   then:  zipalign -f -p 4 out.apk aligned.apk
          apksigner sign --ks <keystore> --ks-key-alias krushikendra aligned.apk
*/
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public class Assemble {
  private static final int ATTR_VERSION_CODE = 0x0101021b;
  private static final int ATTR_VERSION_NAME = 0x0101021c;
  private static final int TYPE_STRING = 0x03;
  private static final int TYPE_INT_DEC = 0x10;

  public static void main(String[] args) throws Exception {
    if (args.length != 2 && args.length != 4)
      throw new IllegalArgumentException("usage: Assemble <srcDir> <out.apk> [<versionCode> <versionName>]");
    Path src = Paths.get(args[0]), out = Paths.get(args[1]);

    List<Entry> entries = new ArrayList<>();
    Path manifestFile = src.resolve("AndroidManifest.xml");
    if (!Files.isRegularFile(manifestFile)) throw new IOException("missing required shell entry: AndroidManifest.xml");
    byte[] manifest = Files.readAllBytes(manifestFile);
    if (args.length == 4) {
      manifest = stamp(manifest, Integer.parseInt(args[2]), args[3]);
      System.out.println("manifest stamped: versionCode=" + args[2] + " versionName=" + args[3]);
    }
    entries.add(new Entry(null, "AndroidManifest.xml", false, manifest));
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
        byte[] raw = e.bytes != null ? e.bytes : Files.readAllBytes(e.file);
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

  private record Entry(Path file, String name, boolean stored, byte[] bytes) {}

  private static void collect(Path file, String name, boolean stored, List<Entry> into) throws IOException {
    if (!Files.isRegularFile(file)) throw new IOException("missing required shell entry: " + name);
    into.add(new Entry(file, name, stored, null));
  }

  private static void collectTree(Path dir, List<Entry> into) throws IOException {
    if (!Files.isDirectory(dir)) throw new IOException("missing required directory: " + dir);
    try (java.util.stream.Stream<Path> walk = Files.walk(dir)) {
      walk.filter(Files::isRegularFile).forEach(p -> {
        String rel = dir.getParent().relativize(p).toString().replace(File.separatorChar, '/');
        into.add(new Entry(p, rel, false, null));
      });
    }
  }

  /** Rewrite versionCode and versionName inside the compiled manifest, in place.
      Anything that would move a byte is refused rather than repaired.

      A compiled manifest does not name its attributes inline: the XML tree holds
      an index into the resource-id map that follows the string pool, so that map
      is read first and the attributes are found by index. */
  private static byte[] stamp(byte[] from, int code, String name) throws IOException {
    byte[] m = from.clone();

    int pool = 8;                                    // ResStringPool follows the file header
    if ((le32(m, pool + 16) & 0x100) != 0)           // flags
      throw new IOException("manifest: UTF-8 string pool is not supported by the in-place patch");
    int strCount = (int) le32(m, pool + 8);
    int stringsStart = (int) le32(m, pool + 20);

    int map = pool + (int) le32(m, pool + 4);        // chunk after the pool
    if (le16(m, map) != 0x0180) throw new IOException("manifest: no resource-id map after the string pool");
    int mapHdr = le16(m, map + 2), mapSize = (int) le32(m, map + 4);
    int ids = (mapSize - mapHdr) / 4;
    int idCode = mapIndexOf(m, map + mapHdr, ids, ATTR_VERSION_CODE);
    int idName = mapIndexOf(m, map + mapHdr, ids, ATTR_VERSION_NAME);

    int codeValue = attrValue(m, map + mapSize, idCode, TYPE_INT_DEC);
    putLE32(m, codeValue + 4, code);

    int nameValue = attrValue(m, map + mapSize, idName, TYPE_STRING);
    int slot = (int) le32(m, nameValue + 4);
    if (slot < 0 || slot >= strCount) throw new IOException("manifest: versionName string index out of range");
    int at = pool + stringsStart + (int) le32(m, pool + 28 + slot * 4);

    int chars = le16(m, at);
    int data = at + 2;
    if ((chars & 0x8000) != 0) { chars = ((chars & 0x7fff) << 16) | le16(m, at + 2); data = at + 4; }
    String old = new String(m, data, chars * 2, java.nio.charset.StandardCharsets.UTF_16LE);
    if (name.length() != old.length())
      throw new IOException("manifest: versionName \"" + old + "\" is " + old.length()
          + " chars, \"" + name + "\" is " + name.length()
          + "; an in-place patch cannot change the length");
    byte[] repl = name.getBytes(java.nio.charset.StandardCharsets.UTF_16LE);
    System.arraycopy(repl, 0, m, data, repl.length);

    // Not "how many bytes changed" - 14 to 22 moves a single byte because the
    // upper three are already zero. Every change must fall inside the two version
    // fields, and nothing outside them may move.
    boolean[] allowed = new boolean[m.length];
    for (int i = codeValue + 4; i < codeValue + 8; i++) allowed[i] = true;
    for (int i = data; i < data + repl.length; i++) allowed[i] = true;
    int changed = 0;
    for (int i = 0; i < m.length; i++) {
      if (m[i] == from[i]) continue;
      if (!allowed[i]) throw new IOException("manifest: patch touched byte " + i + ", outside the version fields");
      changed++;
    }
    if (m.length != from.length)
      throw new IOException("manifest: patch changed the file length");
    return m;
  }

  private static int mapIndexOf(byte[] m, int base, int count, int id) throws IOException {
    for (int i = 0; i < count; i++) if (le32(m, base + i * 4) == id) return i;
    throw new IOException("manifest: attribute id 0x" + Integer.toHexString(id) + " is not in the resource map");
  }

  /** Offset of an attribute's typed value, found by its resource-map name index.
      An attribute is ns(4) name(4) rawValue(4), then size(2) res0(1) type(1) data(4).
      rawValue is not usable as a filter - aapt fills it for some attributes and
      leaves it -1 for others - so the type tag does the discriminating, and
      ambiguity is fatal rather than guessed at. */
  private static int attrValue(byte[] m, int from, int nameIndex, int type) throws IOException {
    int found = -1, hits = 0;
    for (int i = from; i + 16 <= m.length; i += 4) {
      if (le32(m, i) != nameIndex) continue;
      int tv = i + 8;
      if (le16(m, tv) != 8 || m[tv + 2] != 0 || u8(m, tv + 3) != type) continue;
      found = tv; hits++;
    }
    if (hits == 0) throw new IOException("manifest: no attribute with resource-map index " + nameIndex);
    if (hits > 1) throw new IOException("manifest: " + hits + " attributes with index " + nameIndex + "; refusing to guess");
    return found;
  }

  private static long le32(byte[] b, int i) {
    return (b[i] & 0xffL) | (b[i + 1] & 0xffL) << 8 | (b[i + 2] & 0xffL) << 16 | (b[i + 3] & 0xffL) << 24;
  }
  private static int le16(byte[] b, int i) { return (b[i] & 0xff) | (b[i + 1] & 0xff) << 8; }
  private static int u8(byte[] b, int i) { return b[i] & 0xff; }
  private static void putLE32(byte[] b, int i, int v) {
    b[i] = (byte) v; b[i + 1] = (byte) (v >>> 8); b[i + 2] = (byte) (v >>> 16); b[i + 3] = (byte) (v >>> 24);
  }
}
