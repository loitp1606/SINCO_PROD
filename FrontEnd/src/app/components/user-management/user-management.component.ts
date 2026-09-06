import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { UserService } from '../../services/user.service';
import { User, UserCreateDto, UserUpdateDto } from '../../models/user.model';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { UserDialogComponent } from './user-dialog.component';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSnackBarModule
  ],
  templateUrl: './user-management.component.html',
  styleUrls: ['./user-management.component.scss']
})
export class UserManagementComponent implements OnInit {
  users: User[] = [];
  displayedColumns: string[] = ['userId', 'userName', 'fullName', 'isLocked', 'createdAt', 'actions'];
  searchText: string = '';

  constructor(
    protected userService: UserService,
    protected dialog: MatDialog,
    protected snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.loadUsers();
  }

  loadUsers() {
    this.userService.getAllUsers().subscribe({
      next: (users) => {
        this.users = users;
      },
      error: (error) => {
        this.showMessage('Lỗi khi tải danh sách người dùng');
      }
    });
  }

  searchUsers() {
    if (this.searchText.trim()) {
      this.userService.searchUsers(this.searchText).subscribe({
        next: (users) => {
          this.users = users;
        },
        error: (error) => {
          this.showMessage('Lỗi khi tìm kiếm người dùng');
        }
      });
    } else {
      this.loadUsers();
    }
  }

  openCreateDialog() {
    const dialogRef = this.dialog.open(UserDialogComponent, {
      width: '400px',
      data: { mode: 'create' }
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log(result);
      if (result) {
        this.userService.createUser(result).subscribe({
          next: () => {
            this.loadUsers();
            this.showMessage('Tạo người dùng thành công');
          },
          error: (error) => {
            this.showMessage('Lỗi khi tạo người dùng');
          }
        });
      }
    });
  }

  openEditDialog(user: User) {
    const dialogRef = this.dialog.open(UserDialogComponent, {
      width: '400px',
      data: { mode: 'edit', user }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.userService.updateUser(user.userId, result).subscribe({
          next: () => {
            this.loadUsers();
            this.showMessage('Cập nhật người dùng thành công');
          },
          error: (error) => {
            this.showMessage('Lỗi khi cập nhật người dùng');
          }
        });
      }
    });
  }

  deleteUser(userId: number) {
    if (confirm('Bạn có chắc chắn muốn xóa người dùng này?')) {
      this.userService.deleteUser(userId).subscribe({
        next: () => {
          this.loadUsers();
          this.showMessage('Xóa người dùng thành công');
        },
        error: (error) => {
          this.showMessage('Lỗi khi xóa người dùng');
        }
      });
    }
  }

  protected showMessage(message: string) {
    this.snackBar.open(message, 'Đóng', {
      duration: 3000
    });
  }
}
