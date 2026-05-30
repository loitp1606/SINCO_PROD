
//function setImage() {
  window.setImage = async (imageElementId, imageStream) => {
    const arrayBuffer = await imageStream.arrayBuffer();
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    const image = document.getElementById(imageElementId);
    image.onload = () => {
        URL.revokeObjectURL(url);
    }
    image.src = url;
  }

  window.downloadFileFromStream = async (fileName, contentStreamReference) => {
    const arrayBuffer = await contentStreamReference.arrayBuffer();
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    const anchorElement = document.createElement('a');
    anchorElement.href = url;
    anchorElement.download = fileName ?? '';
    anchorElement.click();
    anchorElement.remove();
    URL.revokeObjectURL(url);
  }

window.openFileInNewTab = (fileData, mimeType, fileName) => {
    const blob = new Blob([fileData], { type: mimeType });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;

    const newTab = window.open(a.href, '_blank');

    window.URL.revokeObjectURL(url);
};

window.subscribeToAfterPrintEvent = () => {
    window.addEventListener('afterprint', () => {
        window.history.back();
    });
};
//}