/* Repacks KrushiKendra.apk with the web content from src/assets, keeping every
   other entry byte-for-byte identical to the installed app.
   ---------------------------------------------------------------------------
   The shell in classes.dex is not a plain WebView wrapper: it serves the app
   from the fake origin https://app.krushikendra/ (which is where the shop's
   IndexedDB lives), implements the AndroidBridge that writes backups into
   Downloads, hooks printing to the system print service, and routes the back
   button into JS. Rewriting it from decompiled hints risks all of that, so this
   tool never touches it. It copies the original entries verbatim, drops the old
   signature block, and writes the assets from the working tree instead.

   resources.arsc must stay STORED: Android memory-maps it, and re-compressing it
   breaks the launcher icon, label and theme.

   usage: java Repak <base.apk> <out.apk> <assetsRoot>
   then:  zipalign -f -p 4 out.unsigned.apk out.aligned.apk
          apksigner sign --ks <keystore> --ks-key-alias krushikendra out.aligned.apk
*/
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public class Repak {
  public static void main(String[] args) throws Exception {
    if (args.length != 3) throw new IllegalArgumentException("usage: Repak <base.apk> <out.apk> <assetsRoot>");
    Path base = Paths.get(args[0]), out = Paths.get(args[1]), root = Paths.get(args[2]);

    // Every file under the assets root, keyed by the name it must carry in the APK.
    Map<String, Path> assets = new TreeMap<>();
    try (java.util.stream.Stream<Path> walk = Files.walk(root)) {
      walk.filter(Files::isRegularFile).forEach(p -> {
        String rel = root.relativize(p).toString().replace(File.separatorChar, '/');
        assets.put("assets/" + rel, p);
      });
    }

    int copied = 0, replaced = 0, dropped = 0;
    Set<String> written = new LinkedHashSet<>();
    try (ZipFile in = new ZipFile(base.toFile());
         ZipOutputStream zos = new ZipOutputStream(new BufferedOutputStream(Files.newOutputStream(out)))) {
      zos.setLevel(9);
      for (Enumeration<? extends ZipEntry> e = in.entries(); e.hasMoreElements(); ) {
        ZipEntry src = e.nextElement();
        String name = src.getName();
        if (name.startsWith("META-INF/")) { dropped++; continue; }        // old signature
        if (name.startsWith("assets/")) {
          if (assets.containsKey(name)) { copyEntry(zos, name, in.getInputStream(src)); replaced++; written.add(name); }
          continue;                                                        // rest rewritten below
        }
        ZipEntry dst = new ZipEntry(name);
        dst.setTime(src.getTime());
        if (src.getMethod() == ZipEntry.STORED) {                          // resources.arsc
          byte[] raw = readAll(in.getInputStream(src));
          CRC32 crc = new CRC32(); crc.update(raw);
          dst.setMethod(ZipEntry.STORED);
          dst.setSize(raw.length); dst.setCompressedSize(raw.length); dst.setCrc(crc.getValue());
          zos.putNextEntry(dst); zos.write(raw);
        } else {
          dst.setMethod(ZipEntry.DEFLATED);
          zos.putNextEntry(dst); pipe(in.getInputStream(src), zos);
        }
        zos.closeEntry(); copied++; written.add(name);
      }
      for (Map.Entry<String, Path> a : assets.entrySet()) {
        if (written.contains(a.getKey())) continue;
        copyEntry(zos, a.getKey(), new BufferedInputStream(Files.newInputStream(a.getValue())));
        replaced++;
      }
    }
    System.out.println("shell entries copied verbatim: " + copied);
    System.out.println("asset entries written:        " + replaced);
    System.out.println("old signature entries dropped:" + dropped);
  }

  private static void copyEntry(ZipOutputStream zos, String name, InputStream src) throws IOException {
    ZipEntry e = new ZipEntry(name);
    e.setTime(0);                                  // fixed date: the same tree repacks identically
    e.setMethod(ZipEntry.DEFLATED);
    zos.putNextEntry(e);
    pipe(src, zos);
    zos.closeEntry();
  }

  private static void pipe(InputStream in, OutputStream out) throws IOException {
    byte[] buf = new byte[8192]; int n;
    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    in.close();
  }

  private static byte[] readAll(InputStream in) throws IOException {
    ByteArrayOutputStream bo = new ByteArrayOutputStream(); pipe(in, bo); return bo.toByteArray();
  }
}
