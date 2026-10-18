# Group Sheet Editor: escritorio

Desde el proyecto web, instala sus dependencias con `npm ci`. En esta carpeta ejecuta `npm ci` y `npm start`. El arranque compila el editor actual del directorio padre en `dist/`; no utiliza la copia antigua de `src/web`. Para otra ubicación del editor, configura `GSE_WEB_ROOT`.

## Accesos para Windows

Requieren Node.js 22 o posterior con npm. En la raíz del proyecto:

- `compilar-instalador.bat`: instala las dependencias si faltan, compila el editor y genera `release/Group-Sheet-Editor-Setup-1.0.2-x64.exe` dentro de esta carpeta. El instalador permite elegir destino. La primera compilación necesita Internet para descargar las herramientas de empaquetado.
- `desarrollo-escritorio.bat`: instala las dependencias si faltan y abre Electron conectado al servidor local Vite, con recarga de los cambios del editor. Al cerrar Electron o pulsar Ctrl+C se detiene el servidor. Los cambios en `main.js` o `preload.js` requieren reiniciar el comando.

Equivalentes desde esta carpeta: `npm run dist:win` y `npm run dev`. El modo de desarrollo usa la misma configuración y biblioteca de trabajo que `npm start`.

## Carpeta de trabajo

El primer arranque solicita una carpeta. La ruta y el intervalo de copias se guardan en `userData/workspace-settings.json`, fuera de los documentos transportables. Si la carpeta deja de estar disponible, se solicita otra. Cancelar el primer arranque cierra la aplicación.

La carpeta contiene:

- `Songs/`: un documento JSON `.gse` por canción.
- `Collections/`: un documento JSON `.col` por colección.
- `Exported/`: exportaciones de canciones, colecciones, PDF, EPUB, MusicXML y backups manuales.
- `Backup/`: backups automáticos y copias previas a importar un backup sobre datos existentes.

Los documentos de escritorio usan nombres legibles: `Título — Autor.gse` (o `Título.gse` si no hay autor) y `Nombre de colección.col`. Se conservan los acentos; se limpian los caracteres incompatibles y los nombres repetidos reciben sufijos `(2)`, `(3)`, etc. Cambiar el título o el autor desde el editor actualiza el nombre del archivo sin cambiar su ID. Los nombres personalizados desde el explorador se conservan al modificar otros datos.

Al abrir una biblioteca antigua, los archivos cuyo nombre es su ID o el hash generado por versiones anteriores se convierten automáticamente a nombres legibles. Antes se crea una copia en `Backup/`; si el renombrado falla se restauran los nombres originales. Los IDs, las referencias de colecciones y el formato de los backups y de la versión web se mantienen.

En **Opciones → Configuración** o **Ajustes** se puede cambiar de carpeta, crear una copia y configurar el intervalo. El valor inicial es **5 minutos**; **0** desactiva las copias automáticas. Cada copia tiene fecha y un nombre único, incluye canciones y colecciones, y es compatible con la importación de backups de la versión web. Las copias se conservan hasta que el usuario las elimine.

## Traslado entre ordenadores

Cada canción y colección conserva un `id` dentro del archivo. Los documentos nuevos usan UUID; se respetan los identificadores de documentos importados. El campo `songs` de una colección contiene una lista ordenada de identificadores de canciones, sin rutas:

```json
{ "id": "id-coleccion", "name": "Directo", "songs": ["id-cancion-2", "id-cancion-1"] }
```

Para trasladar una biblioteca, copia la carpeta de trabajo y selecciónala en el otro ordenador. También puedes copiar los archivos individuales a `Songs/` y `Collections/` antes de iniciar la aplicación. Los nombres de archivo pueden cambiar: al arrancar se indexan sus identificadores internos. Una colección conserva las referencias a canciones que aún no se han copiado; el editor las muestra como no encontradas.

La integridad se comprueba al arrancar, importar, cambiar de carpeta y antes de exportar una colección. El botón **Comprobar colecciones** muestra las colecciones incompletas, las posiciones afectadas y los IDs ausentes. En escritorio vuelve a leer los archivos del disco, por lo que **Volver a comprobar** permite reconocer canciones copiadas o renombradas sin reiniciar. Las referencias se conservan y los enlaces se recuperan cuando vuelve a aparecer el mismo ID. Una colección incompleta no se exporta a `.col`, PDF ni EPUB; los backups completos sí conservan las referencias pendientes.

Importar un `.backup` web genera los documentos individuales. Fusionar conserva documentos ajenos al backup y actualiza los IDs coincidentes; reemplazar deja la biblioteca del backup. La validación precede a las modificaciones. Cada archivo se escribe mediante un temporal y un renombrado; si una actualización de varios archivos falla, se intenta restablecer su estado anterior. Los archivos no relacionados se conservan.

La versión web sigue usando `localStorage`; sus datos no se copian automáticamente al escritorio. Utiliza **Exportar → Copia de seguridad** e importa el `.backup` en el escritorio. La importación ofrece **Fusionar bibliotecas**, **Reemplazar biblioteca…** y **Cancelar**; reemplazar requiere otra confirmación. Cancelar, pulsar Escape o cerrar el diálogo no inicia ninguna importación. Las exportaciones con letras permiten **Exportar con letras**, **Exportar sin letras** o **Cancelar** la exportación.

## Comprobaciones

`npm test` comprueba persistencia, reinicio, portabilidad, importación web, exportación binaria, errores de escritura, configuración y programación de copias. `npm run build-web` genera la aplicación de escritorio.
