import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

export default {
    id: 'zipfiles',
    handler: (router, { services, getSchema, env }) => {
        const { FilesService } = services;

        router.post('/', async (req, res) => {
            try {
                const { fileIds } = req.body;
                if (!Array.isArray(fileIds) || fileIds.length === 0) {
                    return res.status(400).json({ error: 'No file IDs provided.' });
                }

                const storageRoot = env['STORAGE_LOCAL_ROOT'] || path.resolve('uploads');
                const schema = await getSchema();
                const filesService = new FilesService({ schema });

                const files = await filesService.readByQuery({ filter: { id: { _in: fileIds } } });

                if (!files.length) {
                    return res.status(404).json({ error: 'No files found for provided IDs.' });
                }

                let filesAdded = 0;
                let missingFiles = [];

                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', 'attachment; filename=files.zip');

                const archive = archiver('zip', { zlib: { level: 9 } });
                archive.on('error', err => {
                    console.error('Archiver error:', err);
                    res.status(500).send({ error: err.message });
                });
                archive.pipe(res);

                for (const file of files) {
                    const absPath = path.join(storageRoot, file.filename_disk);
                    if (fs.existsSync(absPath)) {
                        archive.file(absPath, { name: file.filename_download || file.filename_disk });
                        filesAdded++;
                    } else {
                        missingFiles.push(file.id);
                        console.warn(`File not found: ${absPath} (ID: ${file.id})`);
                    }
                }

                if (filesAdded === 0) {
                    archive.abort();
                    return res.status(404).json({ error: 'None of the requested files exist on disk.', missingFiles });
                }

                archive.finalize();
            } catch (err) {
                console.error('Unexpected error:', err);
                res.status(500).json({ error: 'Internal server error', details: err.message });
            }
        });

        return router;
    },
};
