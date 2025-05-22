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

                let filesToAdd = [];
                let missingFiles = [];

                for (const file of files) {
                    const absPath = path.join(storageRoot, file.filename_disk);
                    if (fs.existsSync(absPath)) {
                        filesToAdd.push({
                            absPath,
                            name: file.filename_download || file.filename_disk
                        });
                    } else {
                        missingFiles.push(file.id);
                        console.warn(`File not found: ${absPath} (ID: ${file.id})`);
                    }
                }

                if (filesToAdd.length === 0) {
                    return res.status(404).json({ error: 'None of the requested files exist on disk.', missingFiles });
                }

                // Only now set headers and stream the archive
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', 'attachment; filename=files.zip');

                const archive = archiver('zip', { zlib: { level: 9 } });
                archive.on('error', err => {
                    console.error('Archiver error:', err);
                    // Only try to send error if headers not sent
                    if (!res.headersSent) {
                        res.status(500).send({ error: err.message });
                    } else {
                        res.end();
                    }
                });
                archive.pipe(res);

                for (const file of filesToAdd) {
                    archive.file(file.absPath, { name: file.name });
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
