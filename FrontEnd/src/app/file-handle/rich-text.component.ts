import { Component, Inject } from "@angular/core";
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogActions, MatDialogTitle, MatDialogContent, MatDialogClose } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { FormsModule } from "@angular/forms";
import { CKEditorModule } from "@ckeditor/ckeditor5-angular"; 
import ClassicEditor from "@ckeditor/ckeditor5-build-classic"; 
import DocumentEditor from "@ckeditor/ckeditor5-build-decoupled-document";
export interface DialogData {
content: string;
}

@Component({
 selector: 'app-rich-text',
 standalone: true,
imports: [
        FormsModule, 
        MatDialogActions, 
        MatDialogTitle, 
        MatButtonModule, 
        MatDialogClose, 
        MatDialogContent,
        CKEditorModule // <-- Đã thêm
    ],
 templateUrl: './rich-text.component.html',
})
export class RichTextComponent {
    public Editor: any = DocumentEditor; 
    // Thêm một thuộc tính để lưu trữ đối tượng editor
    public editorInstance: any; 
    editorConfig: any = { // Sử dụng any hoặc kiểu CKEditorConfig chính xác
        placeholder: 'Nhập nội dung chỉnh sửa...',
        licenseKey: 'GPL',
        language: {
            ui: 'vi',
            content: 'vi',
            direction: 'ltr'
        },
        toolbar: {
            items: [
            '|', 
            'bold', 'italic', 'underline', 'strikethrough', 'link',
            '|',
            'fontColor', 'fontBackgroundColor',
            '|',
            // 'outdent','indent',
            '|',
            // 'bulletedList', 'numberedList',
            '|',
            'undo', 'redo'
            ]
        },
    };

    constructor(
    public dialogRef: MatDialogRef<RichTextComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
    ) {}

    // Định nghĩa phương thức onReady
    public onReady(editor: any) {
        this.editorInstance = editor;
        // 1. Lấy tham chiếu đến phần tử chứa toolbar (ví dụ: #toolbar-container)
        const toolbarContainer = document.querySelector( '.toolbar-container' );
        // 2. Chèn thanh công cụ vào container
        toolbarContainer!.appendChild( editor.ui.view.toolbar.element );
    }
}